"""Build local multilingual POI embeddings without API keys."""
from vector_search import build_index
import logging

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        build_index()
    except Exception:
        logging.error("Индекс не создан: проверьте зависимости, данные и доступ к модели.")
        raise SystemExit(1)
