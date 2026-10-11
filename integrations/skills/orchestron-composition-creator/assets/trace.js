"use strict";
// The history is read-only and independent of the card's audio and review draft.
window.CompositionTrace = (() => {
  const labels = {
    en: {title:"How this melody was created",loading:"Loading creation history…",error:"Could not load creation history. Close and reopen to retry.",download:"Download history JSON",parameters:"Parameters",inputs:"Input material",output:"Output material",versions:"Recorded environment",captured:"Captured during execution",declared:"Author-described edit",supplied:"Includes author-supplied records",gap:"Incomplete history",legacy:"Earlier operations or inputs were not recorded. Only known history is shown.",sources:"Contributing candidates",review:"Saved review used at creation",future:"Saved locks for future development",applied:"Locks applied during creation",silence:"Protected silence",none:"None",measure:"Measure",beat:"beat",rangeHelp:"Quarter-note ranges; the end is excluded. Intersecting notes are retained whole.",pitch:"Pitch / primary parent",rhythm:"Rhythm source",unknown:"Role not recorded",exported_phrase:"Imported phrase",assembly:"Phrase placement",seed:"Seed",notes:"Final score data",order:"Original material → current candidate",imported_assembly:"Imported arrangement"},
    de: {title:"So entstand diese Melodie",loading:"Entstehungsverlauf wird geladen…",error:"Verlauf konnte nicht geladen werden. Zum Wiederholen schliessen und erneut öffnen.",download:"Verlauf als JSON herunterladen",parameters:"Parameter",inputs:"Eingangsmaterial",output:"Ausgangsmaterial",versions:"Aufgezeichnete Umgebung",captured:"Bei der Ausführung erfasst",declared:"Vom Autor beschriebene Bearbeitung",supplied:"Enthält vom Autor gelieferte Aufzeichnungen",gap:"Unvollständiger Verlauf",legacy:"Frühere Operationen oder Eingaben wurden nicht erfasst. Nur bekannte Schritte werden angezeigt.",sources:"Beteiligte Kandidaten",review:"Bei der Erstellung verwendete Bewertung",future:"Gespeicherte Sperren für die nächste Entwicklung",applied:"Bei der Erstellung angewendete Sperren",silence:"Geschützte Pausen",none:"Keine",measure:"Takt",beat:"Zählzeit",rangeHelp:"Bereiche in Viertelnoten; das Ende ist ausgeschlossen. Berührte Noten bleiben vollständig erhalten.",pitch:"Tonhöhen / Hauptvorlage",rhythm:"Rhythmusvorlage",unknown:"Rolle nicht erfasst",exported_phrase:"Importierte Phrase",assembly:"Phrasenpositionen",seed:"Startwert",notes:"Daten der fertigen Partitur",order:"Ausgangsmaterial → aktueller Kandidat",imported_assembly:"Importiertes Arrangement"},
    fr: {title:"Comment cette mélodie a été créée",loading:"Chargement de l’historique…",error:"Impossible de charger l’historique. Fermez puis rouvrez pour réessayer.",download:"Télécharger l’historique JSON",parameters:"Paramètres",inputs:"Matériau d’entrée",output:"Matériau de sortie",versions:"Environnement enregistré",captured:"Capturé pendant l’exécution",declared:"Modification décrite par l’auteur",supplied:"Contient des données fournies par l’auteur",gap:"Historique incomplet",legacy:"Les opérations ou entrées antérieures n’ont pas été enregistrées. Seul l’historique connu est affiché.",sources:"Candidats contributeurs",review:"Évaluation utilisée lors de la création",future:"Protections enregistrées pour la suite",applied:"Protections appliquées lors de la création",silence:"Silences protégés",none:"Aucune",measure:"Mesure",beat:"temps",rangeHelp:"Plages en noires ; la fin est exclue. Les notes touchées sont conservées en entier.",pitch:"Hauteurs / parent principal",rhythm:"Source rythmique",unknown:"Rôle non enregistré",exported_phrase:"Phrase importée",assembly:"Placement des phrases",seed:"Graine",notes:"Données de la partition finale",order:"Matériau initial → candidat actuel",imported_assembly:"Arrangement importé"},
    es: {title:"Cómo se creó esta melodía",loading:"Cargando el historial…",error:"No se pudo cargar el historial. Cierra y vuelve a abrir para reintentar.",download:"Descargar historial JSON",parameters:"Parámetros",inputs:"Material de entrada",output:"Material de salida",versions:"Entorno registrado",captured:"Capturado durante la ejecución",declared:"Edición descrita por el autor",supplied:"Incluye registros proporcionados por el autor",gap:"Historial incompleto",legacy:"No se registraron operaciones o entradas anteriores. Solo se muestra el historial conocido.",sources:"Candidatos participantes",review:"Evaluación usada al crear",future:"Bloqueos guardados para el próximo desarrollo",applied:"Bloqueos aplicados durante la creación",silence:"Silencios protegidos",none:"Ninguno",measure:"Compás",beat:"tiempo",rangeHelp:"Rangos en negras; se excluye el final. Las notas que tocan un rango se conservan enteras.",pitch:"Alturas / fuente principal",rhythm:"Fuente rítmica",unknown:"Rol no registrado",exported_phrase:"Frase importada",assembly:"Posición de las frases",seed:"Semilla",notes:"Datos de la partitura final",order:"Material original → candidato actual",imported_assembly:"Arreglo importado"}
  };
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function data(title, value) {
    const details = el("details", undefined, "trace-data");
    details.append(el("summary", title), el("pre", JSON.stringify(value, null, 2)));
    return details;
  }
  function fraction(value) {
    const [n, d = "1"] = String(value).split("/");
    return [BigInt(n), BigInt(d)];
  }
  function position(value, meter, t) {
    const [n, d] = fraction(value), beats = n * BigInt(meter[1]), denominator = d * 4n;
    const barSize = denominator * BigInt(meter[0]), bar = beats / barSize + 1n;
    const remainder = beats % barSize, beat = remainder / denominator + 1n;
    let a = remainder % denominator, b = denominator;
    const numerator = a;
    while (b) [a, b] = [b, a % b];
    const part = numerator ? `+${numerator/a}/${denominator/a}` : "";
    return `${t.measure} ${bar}, ${t.beat} ${beat}${part}`;
  }
  function ranges(title, values, meter, t) {
    const block = el("div", undefined, "trace-ranges");
    block.append(el("strong", title));
    if (!values.length) block.append(el("p", t.none));
    for (const range of values) {
      const exact = `${range.start_qn}:${range.end_qn} qn`;
      let text = exact;
      try { text = `${position(range.start_qn,meter,t)} → ${position(range.end_qn,meter,t)} (${exact})`; } catch { /* Keep exact recorded values. */ }
      block.append(el("p", text));
    }
    return block;
  }
  function panel(item, language, getLocks) {
    const t = labels[language] || labels.en;
    const details = el("details", undefined, "creation-trace"), body = el("div", undefined, "trace-body");
    details.append(el("summary", t.title), body);
    let history = null, pending = false, lockSummary = null;
    const endpoint = `/api/trace/${encodeURIComponent(item.id)}`;
    function draw() {
      body.replaceChildren(el("p", t.order, "hint"));
      const download = el("a", t.download);
      download.href = endpoint; download.download = `${item.id}-history.json`;
      lockSummary = ranges(t.future, getLocks(), item.score.meter, t);
      body.append(download, lockSummary, el("p", t.rangeHelp, "hint"));
      const names = new Map(history.nodes.map(node => [node.id, node.title || node.id]));
      for (const node of history.nodes) {
        const group = el("details", undefined, "trace-candidate"), heading = el("summary");
        group.open = history.roots.includes(node.id);
        heading.append(el("h3", node.title || node.id));
        group.append(heading, el("p", node.id, "identity"));
        if (node.gap) group.append(el("strong", t.gap), el("p", t.legacy, "hint"), data(t.gap, node.gap));
        if (node.origin === "supplied") group.append(el("p", t.supplied, "hint"));
        if (node.seed !== null && node.seed !== undefined) group.append(el("p", `${t.seed}: ${node.seed}`, "hint"));
        if (node.sources.length) {
          group.append(el("strong", t.sources));
          for (const source of node.sources) {
            const contribution = el("details", undefined, "trace-source");
            contribution.append(el("summary", `${t[source.role] || source.role}: ${names.get(source.candidate_id) || source.candidate_id}`));
            contribution.append(el("p", source.candidate_id, "identity"));
            if (source.review) contribution.append(data(t.review, source));
            group.append(contribution);
          }
        }
        const steps = el("ol", undefined, "trace-steps");
        for (const step of node.steps) {
          const entry = el("details", undefined, "trace-step"), row = el("li");
          entry.append(el("summary", step.description), el("code", step.function), el("p", t[step.evidence], "hint"));
          if (step.parameters.locks) entry.append(ranges(t.applied, step.parameters.locks, node.meter, t));
          if (step.parameters.protected_silence?.length) entry.append(ranges(t.silence, step.parameters.protected_silence, node.meter, t));
          entry.append(data(t.parameters, step.parameters), data(t.inputs, step.inputs), data(t.output, step.output));
          row.append(entry); steps.append(row);
        }
        group.append(steps);
        if (node.imported_assembly?.length) group.append(data(t.imported_assembly, node.imported_assembly));
        if (node.versions) group.append(data(t.versions, node.versions));
        if (node.result) group.append(data(t.notes, node.result));
        body.append(group);
      }
      if (history.assembly?.length) body.append(data(t.assembly, history.assembly));
    }
    details.addEventListener("review-saved", () => {
      if (!lockSummary) return;
      const next = ranges(t.future, getLocks(), item.score.meter, t);
      lockSummary.replaceWith(next); lockSummary = next;
    });
    details.addEventListener("toggle", async () => {
      if (!details.open || pending) return;
      if (history) { draw(); return; }
      pending = true; body.replaceChildren(el("p", t.loading));
      try {
        const response = await fetch(endpoint);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || t.error);
        history = result; draw();
      } catch (error) {
        body.replaceChildren(el("p", t.error), el("p", error.message, "hint"));
      } finally { pending = false; }
    });
    return details;
  }
  return {panel};
})();
