"""Numerical fingerprint separate from metadata I/O and timing instrumentation."""
from hashlib import sha256
from pathlib import Path
import ast,json

LEGACY_METHOD='f499329b95993f2553d7e8b40908b2ddebc745877b3eba06140a9dd8964d4bb8'
LEGACY_CALCULATION='43ebbb4859fb216896ab6f4b5b78f8fbcba6261c66d758abc302d041ac229431'

def calculation_signature(root):
    root=Path(root);tree=ast.parse((root/'scripts/export_shared_gdelt.py').read_text(encoding='utf-8'))
    condition=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='condition')
    export=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='export')
    # Only the acquisition of already SHA-verified rows is transport. Keep all
    # cutoff/window validation, filtering, SQL, R support and output semantics.
    body=[n for n in export.body if not (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='rows' for t in n.targets))]
    parts=[ast.dump(condition,include_attributes=False),[ast.dump(n,include_attributes=False) for n in body],
      [(a.arg,ast.dump(a.annotation,include_attributes=False) if a.annotation else None) for a in export.args.args],
      [ast.dump(n,include_attributes=False) for n in export.args.defaults],
      sha256((root/'config/r_definitions.json').read_bytes()).hexdigest(),
      sha256((root/'scripts/r_support.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest()]
    return sha256(json.dumps(parts,sort_keys=True).encode()).hexdigest()

def aggregation_method(root):
    value=calculation_signature(root)
    # Exact known pre-optimization aggregation/config/support implementation.
    # No arbitrary old version is accepted and source row SHA epochs still bind.
    return LEGACY_METHOD if value==LEGACY_CALCULATION else value
