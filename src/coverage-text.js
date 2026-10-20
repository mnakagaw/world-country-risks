const labels={
 ja:{name:'集計に反映済みの15分枠',help:'枠数の意味',detail:'この公開版の集計に使えた15分枠です。原本の所在、正規化、正式な受入、公開集計への反映は別の工程です。枠数だけでは判定可能性や安全を示しません。'},
 en:{name:'15-minute slots used in this published aggregate',help:'What this count means',detail:'This counts the 15-minute slots used by this published aggregate. Raw-file presence, normalization, formal acceptance and publication are separate stages. This count alone does not establish assessability or safety.'},
 es:{name:'Intervalos de 15 minutos usados en el agregado publicado',help:'Qué significa este conteo',detail:'Cuenta los intervalos de 15 minutos usados en este agregado publicado. La existencia del original, normalización, aceptación formal y publicación son etapas distintas. El conteo por sí solo no demuestra capacidad de evaluación ni seguridad.'}
};
export function coverageText(coverage,language='en'){
 const l=labels[language]||labels.en;
 if(!Number.isInteger(coverage?.available_slots)||!Number.isInteger(coverage?.expected_slots)||coverage.expected_slots<=0||coverage.available_slots<0||coverage.available_slots>coverage.expected_slots)return null;
 return {...l,summary:`${l.name}: ${coverage.available_slots}/${coverage.expected_slots}`};
}
