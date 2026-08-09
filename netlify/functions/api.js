const { getStore } = require("@netlify/blobs");
const Busboy = require("busboy");

const STORE_NAME = "studyshare-materials";
const INDEX_KEY = "materials.json";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Netlify Blobs store
function getStudyStore() {
    return getStore({
        name: STORE_NAME
    });
}

// JSON response helper
function json(statusCode, data) {
    return {
        statusCode: statusCode,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
        },
        body: JSON.stringify(data)
    };
}

// Check admin password
function checkPassword(event) {
    const expectedPassword =
        process.env.ADMIN_PASSWORD;

    if (!expectedPassword) {
        return {
            ok: false,
            response: json(500, {
                error: "ADMIN_PASSWORD is not configured in Netlify."
            })
        };
    }

    const headers = event.headers || {};

    const suppliedPassword =
        headers["x-admin-password"] ||
        headers["X-Admin-Password"] ||
        "";

    if (suppliedPassword !== expectedPassword) {
        return {
            ok: false,
            response: json(401, {
                error: "Wrong admin password."
            })
        };
    }

    return {
        ok: true
    };
}

// Get saved materials
async function getMaterials() {
    const store = getStudyStore();

    try {
        const data = await store.get(
            INDEX_KEY, {
                type: "json"
            }
        );

        if (!Array.isArray(data)) {
            return [];
        }

        return data;
    } catch (error) {
        console.error(
            "Error reading materials:",
            error
        );

        return [];
    }
}

// Save materials
async function saveMaterials(materials) {
    const store = getStudyStore();

    await store.setJSON(
        INDEX_KEY,
        materials
    );
}

// Clean file name
function cleanFileName(filename) {
    return String(filename || "file")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 150);
}

// Parse multipart form
function parseMultipart(event) {
    return new Promise(function(resolve, reject) {

        const headers = event.headers || {};

        const contentType =
            headers["content-type"] ||
            headers["Content-Type"] ||
            "";

        if (
            contentType.indexOf("multipart/form-data") === -1
        ) {
            reject(
                new Error(
                    "Please upload using the website form."
                )
            );
            return;
        }

        const busboy = Busboy({
            headers: {
                "content-type": contentType
            },
            limits: {
                fileSize: MAX_FILE_SIZE
            }
        });

        const fields = {};
        let uploadedFile = null;
        let fileTooLarge = false;

        busboy.on(
            "field",
            function(name, value) {
                fields[name] = value;
            }
        );

        busboy.on(
            "file",
            function(fieldname, file, info) {

                const chunks = [];
                let totalSize = 0;

                file.on(
                    "data",
                    function(chunk) {

                        totalSize += chunk.length;

                        if (
                            totalSize > MAX_FILE_SIZE
                        ) {
                            fileTooLarge = true;
                            file.resume();
                            return;
                        }

                        chunks.push(chunk);
                    }
                );

                file.on(
                    "limit",
                    function() {
                        fileTooLarge = true;
                    }
                );

                file.on(
                    "end",
                    function() {

                        if (!fileTooLarge) {
                            uploadedFile = {
                                fieldname: fieldname,
                                filename: info.filename,
                                mimeType: info.mimeType,
                                buffer: Buffer.concat(chunks)
                            };
                        }
                    }
                );
            }
        );

        busboy.on(
            "error",
            function(error) {
                reject(error);
            }
        );

        busboy.on(
            "finish",
            function() {

                if (fileTooLarge) {
                    reject(
                        new Error(
                            "File is too large. Maximum size is 5 MB."
                        )
                    );

                    return;
                }

                resolve({
                    fields: fields,
                    file: uploadedFile
                });
            }
        );

        try {

            const rawBody =
                event.body || "";

            let bodyBuffer;

            if (
                event.isBase64Encoded
            ) {
                bodyBuffer =
                    Buffer.from(
                        rawBody,
                        "base64"
                    );
            } else {
                bodyBuffer =
                    Buffer.from(
                        rawBody,
                        "utf8"
                    );
            }

            busboy.end(bodyBuffer);

        } catch (error) {
            reject(error);
        }
    });
}

// Get material ID from URL
function getMaterialId(event) {

    const path =
        event.path || "";

    const parts =
        path.split("/")
        .filter(Boolean);

    if (parts.length === 0) {
        return null;
    }

    const lastPart =
        parts[parts.length - 1];

    if (
        lastPart === "api" ||
        lastPart === "api.js" ||
        lastPart === "functions"
    ) {
        return null;
    }

    return lastPart;
}

// Main Netlify function
exports.handler = async function(event) {

    try {

        const method =
            event.httpMethod || "GET";

        /*
         * OPTIONS
         */
        if (method === "OPTIONS") {

            return {
                statusCode: 204,

                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
                    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
                },

                body: ""
            };
        }

        /*
         * GET
         *
         * /api
         *
         * Returns all study materials.
         */
        if (method === "GET") {

            const materialId =
                getMaterialId(event);

            /*
             * Download/view a file
             *
             * /api/:id
             */
            if (materialId) {

                const materials =
                    await getMaterials();

                const material =
                    materials.find(
                        function(item) {
                            return item.id === materialId;
                        }
                    );

                if (!material) {

                    return json(404, {
                        error: "Material not found."
                    });
                }

                if (!material.blobKey) {

                    return json(404, {
                        error: "File not found."
                    });
                }

                const store =
                    getStudyStore();

                const file =
                    await store.get(
                        material.blobKey, {
                            type: "arrayBuffer"
                        }
                    );

                if (!file) {

                    return json(404, {
                        error: "Uploaded file not found."
                    });
                }

                const buffer =
                    Buffer.from(file);

                return {
                    statusCode: 200,

                    headers: {
                        "Content-Type": material.mimeType ||
                            "application/octet-stream",

                        "Content-Disposition": 'inline; filename="' +
                            cleanFileName(
                                material.originalName
                            ) +
                            '"',

                        "Cache-Control": "public, max-age=3600",

                        "Access-Control-Allow-Origin": "*"
                    },

                    isBase64Encoded: true,

                    body: buffer.toString("base64")
                };
            }

            /*
             * Return materials list
             */
            const materials =
                await getMaterials();

            materials.sort(
                function(a, b) {

                    return (
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime()
                    );

                }
            );

            return json(
                200,
                materials
            );
        }

        /*
         * POST
         *
         * Upload material
         */
        if (method === "POST") {

            const auth =
                checkPassword(event);

            if (!auth.ok) {
                return auth.response;
            }

            const parsed =
                await parseMultipart(event);

            const fields =
                parsed.fields;

            const file =
                parsed.file;

            if (!file ||
                !file.buffer ||
                file.buffer.length === 0
            ) {

                return json(400, {
                    error: "Please choose a file."
                });
            }

            const safeName =
                cleanFileName(
                    file.filename
                );

            const id =
                Date.now().toString() +
                "-" +
                Math.random()
                .toString(36)
                .substring(2, 8);

            const blobKey =
                "files/" +
                id +
                "-" +
                safeName;

            const store =
                getStudyStore();

            /*
             * Save actual file
             */
            await store.set(
                blobKey,
                file.buffer, {
                    metadata: {
                        contentType: file.mimeType ||
                            "application/octet-stream"
                    }
                }
            );

            let materials =
                await getMaterials();

            /*
             * Detect file type
             */
            let type = "file";

            if (
                file.mimeType ===
                "application/pdf"
            ) {
                type = "pdf";
            } else if (
                file.mimeType &&
                file.mimeType.indexOf(
                    "video/"
                ) === 0
            ) {
                type = "video";
            } else if (
                file.mimeType &&
                file.mimeType.indexOf(
                    "image/"
                ) === 0
            ) {
                type = "image";
            }

            /*
             * Create material information
             */
            const material = {

                id: id,

                title: String(
                    fields.title ||
                    file.filename
                ).trim(),

                description: String(
                    fields.description ||
                    ""
                ).trim(),

                category: String(
                    fields.category ||
                    "Other"
                ).trim(),

                type: type,

                originalName: file.filename,

                mimeType: file.mimeType ||
                    "application/octet-stream",

                size: file.buffer.length,

                blobKey: blobKey,

                createdAt: new Date().toISOString()
            };

            /*
             * Add material
             */
            materials.push(
                material
            );

            /*
             * Save updated list
             */
            await saveMaterials(
                materials
            );

            return json(200, {
                message: "Uploaded successfully.",

                material: material
            });
        }

        /*
         * DELETE
         *
         * /api/:id
         */
        if (method === "DELETE") {

            const auth =
                checkPassword(event);

            if (!auth.ok) {
                return auth.response;
            }

            const materialId =
                getMaterialId(event);

            if (!materialId) {

                return json(400, {
                    error: "Material ID is required."
                });
            }

            const materials =
                await getMaterials();

            const material =
                materials.find(
                    function(item) {
                        return item.id === materialId;
                    }
                );

            if (!material) {

                return json(404, {
                    error: "Material not found."
                });
            }

            /*
             * Delete uploaded file
             */
            if (material.blobKey) {

                try {

                    const store =
                        getStudyStore();

                    await store.delete(
                        material.blobKey
                    );

                } catch (error) {

                    console.error(
                        "Blob deletion error:",
                        error
                    );
                }
            }

            /*
             * Remove from index
             */
            const updatedMaterials =
                materials.filter(
                    function(item) {
                        return item.id !== materialId;
                    }
                );

            await saveMaterials(
                updatedMaterials
            );

            return json(200, {
                message: "Deleted successfully."
            });
        }

        /*
         * Unsupported method
         */
        return json(405, {
            error: "Method not allowed."
        });

    } catch (error) {

        console.error(
            "StudyShare API error:",
            error
        );

        return json(500, {
            error: error && error.message ?
                error.message : "Server error."
        });
    }
};