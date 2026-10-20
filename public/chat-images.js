export const CHAT_IMAGE_LIMIT = 10;
export const CHAT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_IMAGE_RESIZE_BYTES = 1024 * 1024;
export const CHAT_IMAGE_MAX_EDGE = 1024;

const CHAT_IMAGE_MIME = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const CHAT_IMAGE_EXTENSION = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i;

function normalizedMime(value = "") {
  const mime = String(value || "").toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function mimeFromName(name = "") {
  const match = String(name).toLowerCase().match(CHAT_IMAGE_EXTENSION);
  if (!match) return "";
  const extension = match[1] === "jpg" ? "jpeg" : match[1];
  return `image/${extension}`;
}

export function isChatImageFile(file) {
  const type = normalizedMime(file?.type);
  return CHAT_IMAGE_MIME.has(type) || CHAT_IMAGE_MIME.has(mimeFromName(file?.name));
}

export function shouldDownscaleChatImage(file) {
  return Number(file?.size) > CHAT_IMAGE_RESIZE_BYTES && normalizedMime(file?.type) !== "image/gif";
}

export function chatImageDataUrl(mimeType, data) {
  const mime = normalizedMime(mimeType);
  const bytes = String(data || "").replace(/\s/g, "");
  if (!CHAT_IMAGE_MIME.has(mime) || !bytes || !/^[a-z0-9+/]+={0,2}$/i.test(bytes)) return "";
  return `data:${mime};base64,${bytes}`;
}

export function inlineImageUrl(attachment) {
  if (!attachment || typeof attachment !== "object") return "";
  for (const value of [attachment.url, attachment.previewUrl]) {
    if (typeof value === "string" && SAFE_DATA_IMAGE.test(value)) return value.replace(/\s/g, "");
  }
  if (typeof attachment.data === "string" && typeof attachment.mimeType === "string") {
    return chatImageDataUrl(attachment.mimeType, attachment.data);
  }
  return "";
}

export function draftAttachment(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const copy = { ...item };
  let omitted = false;
  if (typeof copy.data === "string") {
    delete copy.data;
    omitted = true;
  }
  if (typeof copy.previewUrl === "string" && copy.previewUrl.startsWith("data:")) {
    delete copy.previewUrl;
    omitted = true;
  }
  if (omitted) copy.inlineOmitted = true;
  return copy;
}

function dataUrlParts(value) {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mimeType = normalizedMime(match[1]);
  if (!CHAT_IMAGE_MIME.has(mimeType)) return null;
  return { mimeType, data: match[2].replace(/\s/g, "") };
}

async function defaultReadDataUrl(file) {
  const mime = CHAT_IMAGE_MIME.has(normalizedMime(file?.type)) ? normalizedMime(file.type) : mimeFromName(file?.name);
  if (!mime) throw new Error("Unsupported image type");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function downscaleChatImage(file, options) {
  const createBitmap = options.createBitmap || globalThis.createImageBitmap;
  const document = options.document || globalThis.document;
  if (typeof createBitmap !== "function" || typeof document?.createElement !== "function") return null;
  const bitmap = await createBitmap(file);
  try {
    const scale = Math.min(1, CHAT_IMAGE_MAX_EDGE / Math.max(bitmap.width || 1, bitmap.height || 1));
    const width = Math.max(1, Math.round((bitmap.width || 1) * scale));
    const height = Math.max(1, Math.round((bitmap.height || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.toDataURL !== "function") return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return dataUrlParts(canvas.toDataURL("image/jpeg", 0.85));
  } finally {
    bitmap.close?.();
  }
}

export async function readChatImageFile(file, options = {}) {
  if (!isChatImageFile(file)) throw new Error("Unsupported image type");
  if (Number(file?.size) > CHAT_IMAGE_MAX_BYTES) throw new Error("Upload is too large");
  const readDataUrl = options.readDataUrl || defaultReadDataUrl;
  const original = dataUrlParts(await readDataUrl(file));
  if (!original) throw new Error("Failed to read image");
  let result = original;
  if (shouldDownscaleChatImage(file) && options.skipResize !== true) {
    const resized = await downscaleChatImage(file, options).catch(() => null);
    if (resized?.data && resized.data.length < original.data.length) result = resized;
  }
  const previewUrl = chatImageDataUrl(result.mimeType, result.data);
  if (!previewUrl) throw new Error("Failed to read image");
  const filename = String(file?.name || "image").split(/[\\/]/).filter(Boolean).at(-1) || "image";
  return {
    kind: "image",
    isImage: true,
    filename,
    mimeType: result.mimeType,
    data: result.data,
    previewUrl,
  };
}
