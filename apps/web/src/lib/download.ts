"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useAction, useConvex } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

export async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function usePacketDownload(clientId: Id<"clients">) {
  const convex = useConvex();
  const regenerate = useAction(api.packets.regeneratePacket);
  const [downloading, setDownloading] = useState(false);

  const download = async (packetDirty: boolean | undefined) => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (packetDirty) {
        await regenerate({ clientId });
      }
      const url = await convex.query(api.clients.getPacketDownloadUrl, { clientId });
      if (!url) throw new Error("No packet available");
      await downloadFile(url, "Packet.pdf");
    } catch {
      toast.error("Could not download the packet.");
    } finally {
      setDownloading(false);
    }
  };

  return { download, downloading };
}
