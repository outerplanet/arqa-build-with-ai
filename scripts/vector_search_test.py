"""Deterministic index invariants, independent of network and model downloads."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import vector_search as search


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        self.dataset = directory / "poi.json"
        self.index = directory / "index.json"
        self.places = [{"id": "osm:node/1", "name": "Музей", "category": "museum", "tags": []},
            {"id": "osm:node/2", "name": "Кофе", "category": "cafe", "tags": []}]
        self.dataset.write_text(json.dumps(self.places), encoding="utf-8")
        self.environment = patch.dict(os.environ, {"EMBEDDING_DATASET_PATH": str(self.dataset),
            "EMBEDDING_INDEX_PATH": str(self.index)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.payload = {"model": search.MODEL, "dims": 384,
            "datasetSha256": hashlib.sha256(self.dataset.read_bytes()).hexdigest(),
            "byId": {"osm:node/1": [3, 4] + [0] * 382, "osm:node/2": [0, 1] + [0] * 382}}
        self.index.write_text(json.dumps(self.payload), encoding="utf-8")

    def test_cosine_returns_metadata_and_source_text(self):
        with patch.object(search, "query_embedding", return_value=[1] + [0] * 383):
            results = search.vector_search("культура", 1)
        self.assertEqual(results[0]["metadata"], self.places[0])
        self.assertIn("Музей", results[0]["text"])
        self.assertAlmostEqual(results[0]["similarity"], 0.6)

    def test_stale_dataset_refuses_before_embedding_private_query(self):
        self.dataset.write_text("[]", encoding="utf-8")
        with patch.object(search, "query_embedding") as embed:
            with self.assertRaises(ValueError):
                search.vector_search("private")
            embed.assert_not_called()

    def test_wrong_model_and_dimensions_refuse_before_embedding(self):
        for key, value in [("model", "wrong"), ("dims", 256)]:
            self.index.write_text(json.dumps({**self.payload, key: value}), encoding="utf-8")
            with patch.object(search, "query_embedding") as embed:
                with self.assertRaises(ValueError):
                    search.vector_search("private")
                embed.assert_not_called()

    def test_invalid_limits_and_vectors_are_rejected(self):
        for limit in [0, 101, True, 1.5]:
            with self.assertRaises(ValueError):
                search.vector_search("museum", limit)
        for vector in [[0] * 384, [float("nan")] * 384, [1]]:
            with self.assertRaises(ValueError):
                search.normalized(vector)

    def test_large_finite_coordinates_normalize_without_overflow(self):
        result = search.normalized([1e308] * 384)
        self.assertAlmostEqual(sum(x*x for x in result), 1)

    def test_dotenv_is_loaded_but_exported_environment_wins(self):
        directory = Path(self.temporary.name)
        (directory / ".env").write_text("EMBEDDING_CACHE=cache-from-file\nEMBEDDING_MODEL=model-from-file\n", encoding="utf-8")
        with patch.dict(os.environ, {"EMBEDDING_CACHE": "cache-from-shell"}, clear=True), patch.object(Path, "cwd", return_value=directory):
            config = search.settings()
            self.assertEqual(config["cache"], "cache-from-shell")
            self.assertEqual(config["model"], "model-from-file")


if __name__ == "__main__":
    unittest.main()
