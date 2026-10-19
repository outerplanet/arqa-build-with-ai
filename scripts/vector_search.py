"""Local multilingual embeddings and immutable, fingerprinted cosine search.

Queries arrive on stdin and are never logged or saved. Only the explicit index
command may download a model; query execution is always offline.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import logging
import math
from numbers import Real
import os
from pathlib import Path
import sys
import tempfile
from dotenv import load_dotenv

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DIMENSIONS = 384
CATEGORY_TEXT = {
    "cafe": "кафе кофе", "restaurant": "ресторан еда", "fast_food": "быстрая еда",
    "bar": "бар напитки", "nightclub": "ночной клуб танцы", "museum": "музей выставка культура",
    "gallery": "галерея искусство", "theatre": "театр спектакль", "cinema": "кинотеатр кино",
    "park": "парк прогулка природа", "garden": "сад природа", "playground": "детская площадка",
    "viewpoint": "смотровая площадка панорама", "attraction": "достопримечательность архитектура",
    "monument": "памятник история", "artwork": "искусство скульптура", "mall": "торговый центр",
    "library": "библиотека книги", "zoo": "зоопарк животные", "theme_park": "парк развлечений",
    "sports": "спорт", "place_of_worship": "религиозная архитектура", "other": "место",
}


def document(place):
    """Describe source fields; category translations add no claims about a POI."""
    return " · ".join(filter(None, [place["name"], place.get("nameEn"),
        CATEGORY_TEXT.get(place["category"], place["category"]),
        ", ".join(place.get("tags", [])), place.get("description")]))


def settings():
    load_dotenv(Path.cwd() / ".env", override=False)
    return {
        "model": os.environ.get("EMBEDDING_MODEL") or MODEL,
        "cache": os.environ.get("EMBEDDING_CACHE") or ".cache/embeddings",
        "index": Path(os.environ.get("EMBEDDING_INDEX_PATH") or "data/poi.vectors.json"),
        "dataset": Path(os.environ.get("EMBEDDING_DATASET_PATH") or "data/poi.json"),
    }


def model(offline=True):
    """Never execute remote model code; inference uses cached weights only."""
    from sentence_transformers import SentenceTransformer
    cfg = settings()
    if cfg["model"] != MODEL:
        raise ValueError("Unsupported local embedding model")
    return SentenceTransformer(cfg["model"], cache_folder=cfg["cache"],
        local_files_only=offline, trust_remote_code=False, device="cpu")


def query_embedding(query):
    if not isinstance(query, str) or not query.strip() or len(query) > 20000:
        raise ValueError("Invalid query")
    return model().encode([query], normalize_embeddings=True, show_progress_bar=False)[0].tolist()


def normalized(vector):
    if len(vector) != DIMENSIONS or not all(isinstance(x, Real) and math.isfinite(x) for x in vector):
        raise ValueError("Invalid vector")
    scale = max(abs(x) for x in vector)
    if not scale:
        raise ValueError("Zero vector")
    scaled = [x / scale for x in vector]
    norm = math.hypot(*scaled)
    return [x / norm for x in scaled]


def atomic_json(path, payload):
    """Readers see either the previous complete index or the new complete index."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = handle.name
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def build_index():
    cfg = settings()
    raw = cfg["dataset"].read_bytes()
    places = json.loads(raw)
    if not places or len({p["id"] for p in places}) != len(places):
        raise ValueError("Empty dataset or duplicate ids")
    logging.info("Индексация %d мест", len(places))
    vectors = model(offline=False).encode([document(p) for p in places], batch_size=32,
        normalize_embeddings=True, show_progress_bar=False)
    by_id = {p["id"]: [round(float(x), 7) for x in normalized(v)] for p, v in zip(places, vectors, strict=True)}
    if cfg["dataset"].read_bytes() != raw:
        raise ValueError("Dataset changed while indexing")
    fingerprint = hashlib.sha256(raw).hexdigest()
    atomic_json(cfg["index"], {"model": MODEL, "dims": DIMENSIONS,
        "datasetSha256": fingerprint, "byId": by_id})
    atomic_json(cfg["index"].parent / "vector_summary.json", {
        "provider": "local", "model": MODEL, "dimensions": DIMENSIONS,
        "count": len(by_id), "datasetSha256": fingerprint,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "index": str(cfg["index"]), "similarity": "cosine",
        "modelSource": "https://huggingface.co/" + MODEL,
    })
    logging.info("Готово: %d настоящих векторов по %d измерений", len(by_id), DIMENSIONS)


def vector_search(query: str, top_k: int = 5):
    """Return source documents, POI metadata and cosine similarity; reject stale indices."""
    if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= 100:
        raise ValueError("top_k must be an integer between 1 and 100")
    cfg = settings()
    raw = cfg["dataset"].read_bytes()
    index = json.loads(cfg["index"].read_text(encoding="utf-8"))
    if index["model"] != MODEL or index["dims"] != DIMENSIONS or index["datasetSha256"] != hashlib.sha256(raw).hexdigest():
        raise ValueError("Unsupported or stale index; rebuild embeddings")
    query_vector = normalized(query_embedding(query))
    results = []
    for place in json.loads(raw):
        vector = index["byId"].get(place["id"])
        if vector is None:
            continue
        similarity = max(-1.0, min(1.0, sum(a * b for a, b in zip(query_vector, normalized(vector), strict=True))))
        results.append({"text": document(place), "metadata": place, "similarity": similarity})
    return sorted(results, key=lambda item: (-item["similarity"], item["metadata"]["id"]))[:top_k]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["index", "embed-query", "search"])
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        if args.command == "index":
            build_index()
        else:
            payload = json.loads(sys.stdin.read(100000))
            output = ({"model": MODEL, "embedding": query_embedding(payload["query"])}
                if args.command == "embed-query" else vector_search(payload["query"], payload.get("top_k", 5)))
            print(json.dumps(output, ensure_ascii=False, allow_nan=False))
    except Exception:
        logging.error("Локальные эмбеддинги недоступны: проверьте зависимости, кэш модели и соответствие индекса данным.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

