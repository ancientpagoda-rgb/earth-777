const chunks = 6;
const parts = await Promise.all(Array.from({ length: chunks }, (_, index) =>
  fetch(`./app-${index}.b64`, { cache: 'force-cache' }).then((response) => {
    if (!response.ok) throw new Error(`Lite app source ${index}: ${response.status}`);
    return response.text();
  })
));
const binary = atob(parts.join(''));
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
const source = new TextDecoder().decode(bytes);
const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(url);
} finally {
  URL.revokeObjectURL(url);
}
