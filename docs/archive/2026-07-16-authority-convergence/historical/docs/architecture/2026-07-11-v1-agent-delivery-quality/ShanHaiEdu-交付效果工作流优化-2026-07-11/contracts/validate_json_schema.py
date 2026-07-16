import json
import pathlib
import sys

import jsonschema
from referencing import Registry, Resource


root = pathlib.Path(sys.argv[1]).resolve()
instance_path = (root / sys.argv[2]).resolve()
schema_path = (root / sys.argv[3]).resolve()

registry = Registry()
for candidate in root.glob("*.schema.json"):
    document = json.loads(candidate.read_text(encoding="utf-8-sig"))
    if "$id" in document:
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))

schema = json.loads(schema_path.read_text(encoding="utf-8-sig"))
instance = json.loads(instance_path.read_text(encoding="utf-8-sig"))
jsonschema.Draft202012Validator.check_schema(schema)
jsonschema.Draft202012Validator(schema, registry=registry).validate(instance)
print(f"{instance_path}: VALID")
