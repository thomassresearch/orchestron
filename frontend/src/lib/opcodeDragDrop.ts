export const OPCODE_DRAG_MIME = "application/x-visualcsound-opcode";

let activeOpcode: string | null = null;
export const getActiveDraggedOpcode = () => activeOpcode;
export const clearDraggedOpcode = () => { activeOpcode = null; };

export function setDraggedOpcode(dataTransfer: DataTransfer, opcodeName: string): void {
  activeOpcode = opcodeName;
  dataTransfer.setData(OPCODE_DRAG_MIME, opcodeName);
  dataTransfer.setData("text/plain", opcodeName);
  dataTransfer.effectAllowed = "copy";
}

export function hasDraggedOpcode(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes(OPCODE_DRAG_MIME) || types.includes("text/plain");
}

export function getDraggedOpcodeName(dataTransfer: DataTransfer): string | null {
  const direct = dataTransfer.getData(OPCODE_DRAG_MIME).trim();
  if (direct.length > 0) {
    return direct;
  }

  const fallback = dataTransfer.getData("text/plain").trim();
  if (fallback.length > 0) {
    return fallback;
  }

  return null;
}
