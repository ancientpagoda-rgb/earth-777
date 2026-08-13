const ROOT = "https://api.osf.io/v2/nodes/8n43x/files/osfstorage/";

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "earth-777-krapp-probe/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function listCollection(url, prefix = "") {
  let next = url;
  while (next) {
    const payload = await fetchJson(next);
    for (const entry of payload.data ?? []) {
      const attributes = entry.attributes ?? {};
      const name = attributes.name ?? entry.id;
      const path = `${prefix}/${name}`.replace(/^\/+/, "");
      if (attributes.kind === "folder") {
        const childUrl = entry.relationships?.files?.links?.related?.href;
        console.log(JSON.stringify({ kind: "folder", path }));
        if (childUrl) await listCollection(childUrl, path);
      } else {
        console.log(JSON.stringify({
          kind: attributes.kind ?? "file",
          path,
          size: attributes.size ?? null,
          md5: attributes.extra?.hashes?.md5 ?? null,
          sha256: attributes.extra?.hashes?.sha256 ?? null,
          download: entry.links?.download ?? null
        }));
      }
    }
    next = payload.links?.next ?? null;
  }
}

await listCollection(ROOT);
