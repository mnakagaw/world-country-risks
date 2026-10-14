import {useEffect, useState} from 'react';
import {interestQuery, selectedInterest, interestHistoryLink} from '../google-interest';
import './CountryGoogleInterest.css';

const labels = {
    ja:{title:'人々の関心 · Google Trends', loading:'日次固定版を確認しています…', unavailable:'この日の観測は未取得、または再確認待ちです。', unsupported:'この国・地域の取得は非対応です。', empty:'この期間の検索語は未観測です。', rise:'↑ 概算枠が増加', fresh:'新規観測', history:'ExecBriefで保存履歴を見る', note:'24時間内の最大観測概算枠順・各国5語。公式順位や検索総数ではありません。初観測は事件発生時刻を示しません。', partial:'観測', retry:'Google取得頻度制限・再確認待ち', states:{ok:'取得成功',failed:'取得失敗',empty:'空の応答',not_observed:'未観測',stale:'再確認待ち',unsupported:'取得非対応'}},
    en:{title:'People’s interests · Google Trends',loading:'Checking the sealed daily edition…',unavailable:'No verified observation for this date, or awaiting recheck.',unsupported:'Collection is unsupported for this country or territory.',empty:'No search terms observed in this window.',rise:'↑ Observed bucket increased',fresh:'First observation',history:'View saved history on ExecBrief',note:'Up to five terms ordered by the largest observed approximate bucket in 24 hours. This is not an official rank or a search total. First observation is not incident onset.',partial:'Observed',retry:'Google rate limit · awaiting recheck',states:{ok:'Retrieved',failed:'Retrieval failed',empty:'Empty response',not_observed:'Not observed',stale:'Awaiting recheck',unsupported:'Unsupported'}},
    es:{title:'Interés de las personas · Google Trends',loading:'Consultando la edición diaria fija…',unavailable:'Sin observación verificada para esta fecha o pendiente de revisión.',unsupported:'Obtención no disponible para este país o territorio.',empty:'No se observaron términos en este período.',rise:'↑ Aumentó el rango observado',fresh:'Primera observación',history:'Ver historial guardado en ExecBrief',note:'Hasta cinco términos ordenados por el mayor rango aproximado observado en 24 horas. No es clasificación oficial ni total de búsquedas. La primera observación no indica el inicio del incidente.',partial:'Observado',retry:'Límite de Google · pendiente de revisión',states:{ok:'Obtenido',failed:'Falló la obtención',empty:'Respuesta vacía',not_observed:'No observado',stale:'Pendiente de revisión',unsupported:'No disponible'}}
};

export default function CountryGoogleInterest({country, day, lang}) {
    const [state, setState] = useState({status:'loading'});
    useEffect(() => {
        const abort = new AbortController(); setState({status:'loading'});
        (async () => {
            try {
                const response = await fetch(interestQuery(country,day), {signal:abort.signal,cache:'no-store'});
                const value = await response.json();
                if (!response.ok) {setState({status:value.source_status === 'not_registered' ? 'unsupported' : 'unavailable'});return;}
                setState({status:'ready',value:selectedInterest(value,country,day)});
            } catch (error) {if (error.name !== 'AbortError') setState({status:'unavailable'});}
        })();
        return () => abort.abort();
    }, [country,day]);
    const l=labels[lang]||labels.en, value=state.value, card=value?.card;
    const stamp=at=>new Date(at).toLocaleString(lang==='ja'?'ja-JP':lang==='es'?'es-ES':'en-GB',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})+' JST';
    return <section className="country-google-interest" data-interest-country={country} data-interest-day={day}>
        <h4>{l.title}</h4>
        {value ? <>
            <p className="interest-period">{day} · {stamp(value.window.start_utc)} → {stamp(value.window.end_utc)}</p>
            <p role="status">{l.states[card.source_status]||card.source_status} · {l.partial} {card.coverage?.successful_slots??0}/96</p>
            {value.provider_status?.status==='rate_limited' && <p>{l.retry}</p>}
            {card.top5.length ? <ol>{card.top5.map((topic,i)=><li key={topic.normalized_query_key||i}>
                <span className="interest-query">{topic.raw_query}</span>
                {topic.bucket_increased_in_window ? <strong className="interest-change">{l.rise}</strong> : topic.change?.status==='new_observation' ? <span className="interest-first">{l.fresh}</span> : null}
                <small>{topic.largest_observed_traffic_bucket||'?'}</small>
            </li>)}</ol> : <p>{l.empty}</p>}
        </> : <p role="status">{l[state.status]}</p>}
        <a href={interestHistoryLink(country,day)} target="_blank" rel="noopener noreferrer">{l.history}</a>
        <p className="interest-note">{l.note}</p>
    </section>;
}
