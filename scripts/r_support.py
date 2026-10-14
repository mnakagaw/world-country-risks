import ast,json,re
from pathlib import Path
from hashlib import sha256
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode

def canonicalizer(root):
    file=Path(root)/'engine/gdelt.py';raw=file.read_bytes();tree=ast.parse(raw)
    nodes=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='canonical_url' or isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='TRACKING_PARAMETERS' for t in node.targets)]
    if len(nodes)!=2:raise ValueError('Shared canonical URL policy missing')
    namespace={'re':re,'urlsplit':urlsplit,'urlunsplit':urlunsplit,'parse_qsl':parse_qsl,'urlencode':urlencode}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(file),'exec'),namespace)
    return namespace['canonical_url'],sha256(raw).hexdigest()

def extract_support(db,definitions,condition,execbrief_root):
    types=['R1','R2','R3','R4'];canonical,policy_sha=canonicalizer(execbrief_root)
    db.execute('CREATE TEMP TABLE r_support_tagged AS SELECT *, '+','.join(condition(definitions[t])+' AS '+t for t in types)+' FROM population')
    support={}
    for type in types:
        other=' OR '.join(t for t in types if t!=type)
        for code,count,urls in db.execute('SELECT ActionGeo_CountryCode,count(*),list(DISTINCT SOURCEURL) FROM r_support_tagged WHERE '+type+' AND NOT ('+other+") AND SOURCEURL LIKE 'http%' GROUP BY ActionGeo_CountryCode").fetchall():
            urls=sorted(set(urls));keys=sorted({sha256(canonical(url).encode()).hexdigest() for url in urls})
            support.setdefault(code,{})[type]={'exclusive_count':count,'article_keys':keys,'examples':urls[:3]}
    overlap=db.execute('SELECT count(*) FROM r_support_tagged WHERE '+ '+'.join('cast('+t+' AS INT)' for t in types)+'>1').fetchone()[0]
    return support,{'multi_label_records_excluded_from_bundle_support':overlap,'canonicalization_source':'ExecBrief engine.gdelt.canonical_url','canonicalization_policy_sha256':policy_sha}
