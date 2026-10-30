// Decode and resize one large phone photo at a time. Smaller photos bypass
// canvas entirely, keeping memory use low on job-site phones.
export async function prepareProgressPhoto(source: File): Promise<File> {
  const supported = ["image/jpeg", "image/png", "image/webp"];
  const convertible = ["image/heic", "image/heif"];
  if (![...supported, ...convertible].includes(source.type)) throw new Error("Choose a JPEG, PNG, WebP, or a camera photo your phone can convert.");
  if (source.size > 30 * 1024 * 1024) throw new Error("This photo is too large. Choose a smaller photo or take another with your camera.");
  if (supported.includes(source.type) && source.size <= 8 * 1024 * 1024) return source;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(source, { resizeWidth: 2048, resizeQuality: "high" }); }
  catch { throw new Error("Your phone could not convert this photo. Try taking a new photo or choosing a JPEG."); }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this photo. Please try a smaller photo.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    canvas.width = 0; canvas.height = 0;
    if (!blob || blob.size > 8 * 1024 * 1024) throw new Error("This photo is still too large. Please choose a smaller photo.");
    return new File([blob], `${source.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } finally { bitmap.close(); }
}
