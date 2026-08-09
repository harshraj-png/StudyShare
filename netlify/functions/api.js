const { getStore } = require("@netlify/blobs");
const Busboy = require("busboy");

const store = () => getStore({ name: "studyshare-materials" });
const INDEX_KEY = "_materials.json";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

async function getMaterials() {
  const data = await store().get(INDEX_KEY, { type: "json" });
  return Array.isArray(data) ? data : [];
}

async function saveMaterials(items) {
  await store().setJSON(INDEX_KEY, items);
}

function checkPassword(event) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, response: json(500, { error: "ADMIN_PASSWORD is not configured in Netlify." }) };
  const supplied = event.headers["x-admin-password"] || event.headers["X-Admin-Password"];
  if (supplied !== expected) return { ok: false, response: json(401, { error: "Wrong admin password." }) };
  return { ok: true };
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return reject(new Error("Please upload using the website form."));
    }

    const bb = Busboy({ headers: { "content-type": contentType } });
    const fields = {};
    let file = null;
    let pending = [];

    bb.on("field", (name, value) => { fields[name] = value; });

    bb.on("file", (name, stream, info) => {
      const chunks = [];
      let size = 0;
      stream.on("data", chunk => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          stream.resume();
          reject(new Error("This Netlify demo upload is limited to 5 MB. For larger videos, use the Supabase/Cloudinary version."));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        file = { field: name, filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) };
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, file }));

    const raw = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
    bb.end(raw);
  });
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;

    if (method === "GET") {
      const items = await getMaterials();
      return json(200, items.sort((a,b) => b.createdAt - a.createdAt));
    }

    if (method === "POST") {
      const auth = checkPassword(event);
      if (!auth.ok) return auth.response;

      const { fields, file } = await parseMultipart(event);
      if (!file || !file.buffer.length) return json(400, { error: "Please choose a file." });

      const safe = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const key = `files/${id}-${safe}`;

      await store().set(key, file.buffer, {
        metadata: { contentType: file.mimeType || "application/octet-stream" }
      });

      const type = (file.mimeType || "").startsWith("video/") ? "video" :
        file.mimeType === "application/pdf" ? "pdf" : "image";

      const material = {
        id,
        title: (fields.title || file.filename).trim(),
        description: (fields.description || "").trim(),
        category: (fields.category || "Other").trim(),
        type,
        originalName: file.filename,
        blobKey: key,
        createdAt: Date.now()
      };

      const items = await getMaterials();
      items.push(material);
      await saveMaterials(items);

      return json(200, { message: "Uploaded successfully.", material });
    }

    if (method === "DELETE") {
      const auth = checkPassword(event);
      if (!auth.ok) return auth.response;

      const id = event.path.split("/").pop();
      const items = await getMaterials();
      const item = items.find(x => x.id === id);
      if (!item) return json(404, { error: "Material not found." });

      await store().delete(item.blobKey);
      await saveMaterials(items.filter(x => x.id !== id));
      return json(200, { message: "Deleted." });
    }

    return json(405, { error: "Method not allowed." });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "Server error." });
  }
};