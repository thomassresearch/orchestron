import type { GuiLanguage } from '../../types';

const en = {
  choose: 'Choose editing scope', change: 'Change scope', linked: 'Shared content', independent: 'Independent content', repeat: 'Loop repetition', base: 'Base pass',
  occurrences: 'arranged occurrences', clips: 'clips', retained: 'Also referenced by unused saved content',
  pattern: 'Edit linked pattern', group: 'Edit linked group', supergroup: 'Edit linked supergroup', variation: 'Create variation here', variationSuffix: 'variation',
  editingAll: 'Editing shared content', editingLocal: 'Editing this occurrence only', allDefinitions: 'All linked definitions',
  saveAll: 'Save to linked occurrences', saveLocal: 'Save variation here', saveStructureAll: 'Save structure · all linked', saveStructureLocal: 'Save structure · local',
  localOnly: 'This operation changes only this clip.', incompatible: 'This operation requires local editing. Change the whole draft to local scope to apply it.',
  chooseHint: 'Choose the scope before editing. Changes apply only when saved.', pending: 'Choose the scope to apply the proposed change to your draft.',
  effects: 'Affected content', newContent: 'New content', scopeChanged: 'Sharing changed. Choose the editing scope again.',
};
type Copy = typeof en;
const de: Copy = {
  choose: 'Bearbeitungsumfang wählen', change: 'Umfang ändern', linked: 'Verknüpfter Inhalt', independent: 'Unabhängiger Inhalt', repeat: 'Schleifenwiederholung', base: 'Basisdurchlauf',
  occurrences: 'angeordnete Vorkommen', clips: 'Clips', retained: 'Auch von ungenutztem gespeichertem Inhalt referenziert',
  pattern: 'Verknüpftes Pattern bearbeiten', group: 'Verknüpfte Gruppe bearbeiten', supergroup: 'Verknüpfte Supergruppe bearbeiten', variation: 'Hier eine Variante erstellen', variationSuffix: 'Variante',
  editingAll: 'Verknüpften Inhalt bearbeiten', editingLocal: 'Nur dieses Vorkommen bearbeiten', allDefinitions: 'Alle verknüpften Definitionen',
  saveAll: 'Verknüpfte Vorkommen speichern', saveLocal: 'Variante hier speichern', saveStructureAll: 'Struktur speichern · alle verknüpften', saveStructureLocal: 'Struktur speichern · lokal',
  localOnly: 'Diese Aktion ändert nur diesen Clip.', incompatible: 'Diese Aktion erfordert lokale Bearbeitung. Den gesamten Entwurf auf lokalen Umfang umstellen, um sie anzuwenden.',
  chooseHint: 'Vor dem Bearbeiten den Umfang wählen. Änderungen gelten erst nach dem Speichern.', pending: 'Umfang wählen, um die vorgeschlagene Änderung auf den Entwurf anzuwenden.',
  effects: 'Betroffener Inhalt', newContent: 'Neuer Inhalt', scopeChanged: 'Die Verknüpfungen haben sich geändert. Bearbeitungsumfang erneut wählen.',
};
const fr: Copy = {
  choose: 'Choisir la portée de modification', change: 'Changer la portée', linked: 'Contenu partagé', independent: 'Contenu indépendant', repeat: 'Répétition de boucle', base: 'Passage de base',
  occurrences: 'occurrences placées', clips: 'clips', retained: 'Également référencé par du contenu enregistré inutilisé',
  pattern: 'Modifier le motif lié', group: 'Modifier le groupe lié', supergroup: 'Modifier le supergroupe lié', variation: 'Créer une variante ici', variationSuffix: 'variante',
  editingAll: 'Modification du contenu partagé', editingLocal: 'Modification de cette occurrence uniquement', allDefinitions: 'Toutes les définitions liées',
  saveAll: 'Enregistrer les occurrences liées', saveLocal: 'Enregistrer la variante ici', saveStructureAll: 'Enregistrer la structure · toutes liées', saveStructureLocal: 'Enregistrer la structure · locale',
  localOnly: 'Cette opération modifie uniquement ce clip.', incompatible: 'Cette opération nécessite une modification locale. Passez tout le brouillon en portée locale pour l’appliquer.',
  chooseHint: 'Choisissez la portée avant de modifier. Les changements s’appliquent à l’enregistrement.', pending: 'Choisissez la portée pour appliquer la modification proposée au brouillon.',
  effects: 'Contenu affecté', newContent: 'Nouveau contenu', scopeChanged: 'Les liaisons ont changé. Choisissez à nouveau la portée.',
};
const es: Copy = {
  choose: 'Elegir alcance de edición', change: 'Cambiar alcance', linked: 'Contenido compartido', independent: 'Contenido independiente', repeat: 'Repetición de bucle', base: 'Pasada base',
  occurrences: 'apariciones colocadas', clips: 'clips', retained: 'También referenciado por contenido guardado sin usar',
  pattern: 'Editar patrón vinculado', group: 'Editar grupo vinculado', supergroup: 'Editar supergrupo vinculado', variation: 'Crear variación aquí', variationSuffix: 'variación',
  editingAll: 'Editando contenido compartido', editingLocal: 'Editando solo esta aparición', allDefinitions: 'Todas las definiciones vinculadas',
  saveAll: 'Guardar apariciones vinculadas', saveLocal: 'Guardar variación aquí', saveStructureAll: 'Guardar estructura · todas vinculadas', saveStructureLocal: 'Guardar estructura · local',
  localOnly: 'Esta operación modifica solo este clip.', incompatible: 'Esta operación requiere edición local. Cambia todo el borrador al alcance local para aplicarla.',
  chooseHint: 'Elige el alcance antes de editar. Los cambios se aplican al guardar.', pending: 'Elige el alcance para aplicar el cambio propuesto al borrador.',
  effects: 'Contenido afectado', newContent: 'Contenido nuevo', scopeChanged: 'Las vinculaciones cambiaron. Elige otra vez el alcance de edición.',
};
export const scopeCopy = (language: GuiLanguage): Copy => ({ english: en, german: de, french: fr, spanish: es })[language];
