"""Build a topology-preserving display overview; retain the original GeoJSON."""
from pathlib import Path
from hashlib import sha256
import json
from shapely.geometry import shape,mapping

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'public/geo/countries.geojson'
target=ROOT/'public/geo/countries.overview.geojson'
receipt=ROOT/'public/geo/countries.overview.metadata.json'
raw=source.read_bytes();value=json.loads(raw);features=[];fallback=[]
for index,feature in enumerate(value['features']):
    original=shape(feature['geometry']);simple=original.simplify(0.025,preserve_topology=True)
    # Preserve every island/territory component and valid input topology.
    def parts(g):return len(g.geoms) if hasattr(g,'geoms') else 1
    if simple.is_empty or simple.geom_type!=original.geom_type or parts(simple)!=parts(original) or (original.is_valid and not simple.is_valid):
        simple=original;fallback.append(index)
    features.append({**feature,'geometry':mapping(simple)})
result={**value,'features':features}
output=(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n').encode()
assert len(features)==len(value['features']) and all(a.get('properties')==b.get('properties') for a,b in zip(value['features'],features))
target.write_bytes(output)
metadata={'schema':'country-map-overview-v1','purpose':'Country monitoring display; not a boundary survey','source_sha256':sha256(raw.replace(b'\r\n',b'\n')).hexdigest(),'overview_sha256':sha256(output).hexdigest(),'source_bytes':len(raw),'overview_bytes':len(output),'features':len(features),'tolerance_degrees':0.025,'preserve_topology':True,'properties_and_component_counts_preserved':True,'fallback_features':fallback,'original_retained':True,'R_calculation_effect':0}
receipt.write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8');print(json.dumps(metadata))
