import { getSupabaseBrowserClient } from "./client";

export type UploadedEvidence = {
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
};

export async function uploadWorksitePhotos(
  organizationId: string,
  projectId: string,
  date: string,
  uploadId: string,
  files: File[],
) {
  const supabase = getSupabaseBrowserClient();
  const uploaded: UploadedEvidence[] = [];

  for (const file of files) {
    const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    const path = [organizationId, projectId, date, uploadId, crypto.randomUUID() + "-" + safeName].join("/");
    const { error } = await supabase.storage.from("worksite-photos").upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    uploaded.push({ storage_path: path, original_name: file.name, mime_type: file.type, size_bytes: file.size });
  }
  return uploaded;
}
