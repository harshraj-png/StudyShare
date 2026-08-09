const { getStore } = require("@netlify/blobs");
const Busboy = require("busboy");
const crypto = require("crypto");

const STORE_NAME = "studyshare-materials";
const INDEX_KEY = "materials.json";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// =====================================================
// NETLIFY BLOBS
// =====================================================

function getStudyStore() {
    return getStore({
        name: STORE_NAME
    });
}

// =====================================================
// JSON RESPONSE
// =====================================================

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

// =====================================================
// FILE RESPONSE
// =====================================================

function fileResponse(statusCode, contentType, body, filename) {
    return {
        statusCode: statusCode,
        isBase64Encoded: true,
        headers: {
            "Content-Type": contentType || "application/octet-stream",

            "Cache-Control": "public, max-age=31536000",

            "Access-Control-Allow-Origin": "*",

            "Content-Disposition": 'inline; filename="' +
                safeFileName(filename || "file") +
                '"'
        },
        body: body
    };
}

// =====================================================
// ADMIN PASSWORD
// =====================================================

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

    let suppliedPassword = "";

    if (headers["x-admin-password"]) {
        suppliedPassword =
            headers["x-admin-password"];
    } else if (headers["X-Admin-Password"]) {
        suppliedPassword =
            headers["X-Admin-Password"];
    }

    if (!suppliedPassword) {
        return {
            ok: false,
            response: json(401, {
                error: "Admin password is required."
            })
        };
    }

    if (suppliedPassword !== expectedPassword) {
        return {
            ok: false,
            response: json(403, {
                error: "Invalid admin password."
            })
        };
    }

    return {
        ok: true
    };
}

// =====================================================
// READ MATERIAL INDEX
// =====================================================

async function readIndex() {
    const store = getStudyStore();

    try {
        const data = await store.get(
            INDEX_KEY, {
                type: "json"
            }
        );

        if (!data) {
            return [];
        }

        if (Array.isArray(data)) {
            return data;
        }

        return [];
    } catch (error) {
        console.log(
            "No materials index found. Creating a new one."
        );

        return [];
    }
}

// =====================================================
// SAVE MATERIAL INDEX
// =====================================================

async function saveIndex(materials) {
    const store = getStudyStore();

    await store.setJSON(
        INDEX_KEY,
        materials
    );
}

// =====================================================
// SAFE FILE NAME
// =====================================================

function safeFileName(filename) {
    if (!filename) {
        return "file";
    }

    return filename
        .replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        )
        .replace(
            /_+/g,
            "_"
        )
        .substring(0, 150);
}

// =====================================================
// FILE EXTENSION
// =====================================================

function getExtension(filename) {
    if (!filename) {
        return "";
    }

    const parts =
        filename.split(".");

    if (parts.length < 2) {
        return "";
    }

    return parts[
            parts.length - 1
        ]
        .toLowerCase()
        .replace(
            /[^a-z0-9]/g,
            ""
        );
}

// =====================================================
// UNIQUE ID
// =====================================================

function createId() {
    return (
        Date.now().toString(36) +
        "-" +
        crypto
        .randomBytes(8)
        .toString("hex")
    );
}

// =====================================================
// MULTIPART PARSER
// =====================================================

function parseMultipart(event) {
    return new Promise(
        function(resolve, reject) {
            try {
                const headers =
                    event.headers || {};

                let contentType = "";

                if (headers["content-type"]) {
                    contentType =
                        headers["content-type"];
                } else if (
                    headers["Content-Type"]
                ) {
                    contentType =
                        headers["Content-Type"];
                }

                if (!contentType
                    .toLowerCase()
                    .includes(
                        "multipart/form-data"
                    )
                ) {
                    reject(
                        new Error(
                            "Request must be multipart/form-data."
                        )
                    );

                    return;
                }

                const busboy =
                    Busboy({
                        headers: {
                            "content-type": contentType
                        },

                        limits: {
                            fileSize: MAX_FILE_SIZE,

                            files: 1
                        }
                    });

                const fields = {};

                let uploadedFile = null;

                let fileTooLarge = false;

                const chunks = [];

                busboy.on(
                    "field",
                    function(
                        name,
                        value
                    ) {
                        fields[name] = value;
                    }
                );

                busboy.on(
                    "file",
                    function(
                        fieldname,
                        stream,
                        info
                    ) {
                        const filename =
                            info.filename;

                        const encoding =
                            info.encoding;

                        const mimeType =
                            info.mimeType;

                        let totalSize = 0;

                        stream.on(
                            "data",
                            function(chunk) {
                                totalSize +=
                                    chunk.length;

                                if (
                                    totalSize <=
                                    MAX_FILE_SIZE
                                ) {
                                    chunks.push(
                                        chunk
                                    );
                                }
                            }
                        );

                        stream.on(
                            "limit",
                            function() {
                                fileTooLarge =
                                    true;
                            }
                        );

                        stream.on(
                            "end",
                            function() {
                                uploadedFile = {
                                    fieldname: fieldname,

                                    filename: filename,

                                    encoding: encoding,

                                    mimeType: mimeType,

                                    size: totalSize,

                                    buffer: Buffer.concat(
                                        chunks
                                    )
                                };
                            }
                        );
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

                busboy.on(
                    "error",
                    function(error) {
                        reject(error);
                    }
                );

                let body =
                    event.body || "";

                if (
                    event.isBase64Encoded
                ) {
                    body =
                        Buffer.from(
                            body,
                            "base64"
                        );
                } else {
                    body =
                        Buffer.from(
                            body,
                            "binary"
                        );
                }

                busboy.end(body);
            } catch (error) {
                reject(error);
            }
        }
    );
}

// =====================================================
// GET MATERIALS / GET FILE
// =====================================================

async function handleGet(event) {
    const query =
        event.queryStringParameters || {};

    // ---------------------------------------------------
    // GET SINGLE FILE
    // ---------------------------------------------------

    if (query.file) {
        const store =
            getStudyStore();

        const blobKey =
            query.file;

        try {
            const arrayBuffer =
                await store.get(
                    blobKey, {
                        type: "arrayBuffer"
                    }
                );

            if (!arrayBuffer) {
                return json(404, {
                    error: "File not found."
                });
            }

            const materials =
                await readIndex();

            let material = null;

            for (
                let i = 0; i < materials.length; i++
            ) {
                if (
                    materials[i]
                    .blobKey ===
                    blobKey
                ) {
                    material =
                        materials[i];

                    break;
                }
            }

            let contentType =
                "application/octet-stream";

            let filename =
                "study-material";

            if (material) {
                if (material.mimeType) {
                    contentType =
                        material.mimeType;
                }

                if (material.fileName) {
                    filename =
                        material.fileName;
                }
            }

            const buffer =
                Buffer.from(
                    arrayBuffer
                );

            return fileResponse(
                200,
                contentType,
                buffer.toString(
                    "base64"
                ),
                filename
            );
        } catch (error) {
            console.error(
                "File retrieval error:",
                error
            );

            return json(500, {
                error: "Unable to retrieve file.",

                message: error.message
            });
        }
    }

    // ---------------------------------------------------
    // GET ALL MATERIALS
    // ---------------------------------------------------

    try {
        let materials =
            await readIndex();

        const search =
            typeof query.search ===
            "string" ?
            query.search
            .trim()
            .toLowerCase() :
            "";

        const category =
            typeof query.category ===
            "string" ?
            query.category
            .trim()
            .toLowerCase() :
            "";

        if (search) {
            materials =
                materials.filter(
                    function(item) {
                        const title =
                            String(
                                item.title || ""
                            ).toLowerCase();

                        const description =
                            String(
                                item.description ||
                                ""
                            ).toLowerCase();

                        const itemCategory =
                            String(
                                item.category || ""
                            ).toLowerCase();

                        return (
                            title.includes(
                                search
                            ) ||
                            description.includes(
                                search
                            ) ||
                            itemCategory.includes(
                                search
                            )
                        );
                    }
                );
        }

        if (
            category &&
            category !== "all"
        ) {
            materials =
                materials.filter(
                    function(item) {
                        return (
                            String(
                                item.category ||
                                ""
                            ).toLowerCase() ===
                            category
                        );
                    }
                );
        }

        materials.sort(
            function(a, b) {
                return (
                    new Date(
                        b.createdAt || 0
                    ) -
                    new Date(
                        a.createdAt || 0
                    )
                );
            }
        );

        return json(200, {
            success: true,
            count: materials.length,
            materials: materials
        });
    } catch (error) {
        console.error(
            "GET error:",
            error
        );

        return json(500, {
            error: "Unable to load study materials.",

            message: error.message
        });
    }
}

// =====================================================
// UPLOAD
// =====================================================

async function handleUpload(event) {
    const auth =
        checkPassword(event);

    if (!auth.ok) {
        return auth.response;
    }

    try {
        const parsed =
            await parseMultipart(
                event
            );

        const fields =
            parsed.fields;

        const file =
            parsed.file;

        if (!file) {
            return json(400, {
                error: "No file was uploaded."
            });
        }

        if (!file.buffer ||
            file.buffer.length ===
            0
        ) {
            return json(400, {
                error: "Uploaded file is empty."
            });
        }

        if (
            file.buffer.length >
            MAX_FILE_SIZE
        ) {
            return json(400, {
                error: "File is larger than 5 MB."
            });
        }

        const title =
            String(
                fields.title || ""
            ).trim();

        const description =
            String(
                fields.description ||
                ""
            ).trim();

        const category =
            String(
                fields.category ||
                "Other"
            ).trim();

        if (!title) {
            return json(400, {
                error: "Title is required."
            });
        }

        const id =
            createId();

        const originalFileName =
            file.filename ||
            "study-material";

        const cleanFileName =
            safeFileName(
                originalFileName
            );

        const extension =
            getExtension(
                cleanFileName
            );

        const blobKey =
            "files/" +
            id +
            "-" +
            cleanFileName;

        // -------------------------------------------------
        // SAVE FILE
        // -------------------------------------------------

        const store =
            getStudyStore();

        await store.set(
            blobKey,
            file.buffer, {
                metadata: {
                    contentType: file.mimeType ||
                        "application/octet-stream"
                }
            }
        );

        // -------------------------------------------------
        // MATERIAL RECORD
        // -------------------------------------------------

        const material = {
            id: id,

            title: title,

            description: description,

            category: category,

            fileName: cleanFileName,

            originalFileName: originalFileName,

            fileSize: file.buffer.length,

            fileSizeMB: Number(
                (
                    file.buffer.length /
                    (1024 * 1024)
                ).toFixed(2)
            ),

            mimeType: file.mimeType ||
                "application/octet-stream",

            extension: extension,

            blobKey: blobKey,

            createdAt: new Date().toISOString(),

            updatedAt: new Date().toISOString()
        };

        // -------------------------------------------------
        // SAVE INDEX
        // -------------------------------------------------

        const materials =
            await readIndex();

        materials.unshift(
            material
        );

        await saveIndex(
            materials
        );

        return json(201, {
            success: true,

            message: "Study material uploaded successfully.",

            material: material
        });
    } catch (error) {
        console.error(
            "Upload error:",
            error
        );

        return json(500, {
            error: "Unable to upload study material.",

            message: error.message
        });
    }
}

// =====================================================
// DELETE
// =====================================================

async function handleDelete(event) {
    const auth =
        checkPassword(event);

    if (!auth.ok) {
        return auth.response;
    }

    try {
        const query =
            event.queryStringParameters || {};

        let id =
            query.id || "";

        // -------------------------------------------------
        // ALSO CHECK BODY
        // -------------------------------------------------

        if (!id &&
            event.body
        ) {
            try {
                let body =
                    event.body;

                if (
                    event.isBase64Encoded
                ) {
                    body =
                        Buffer.from(
                            body,
                            "base64"
                        ).toString(
                            "utf8"
                        );
                }

                const parsed =
                    JSON.parse(body);

                if (parsed.id) {
                    id =
                        parsed.id;
                }
            } catch (error) {
                console.log(
                    "DELETE body was not JSON."
                );
            }
        }

        if (!id) {
            return json(400, {
                error: "Material ID is required."
            });
        }

        const materials =
            await readIndex();

        let materialIndex = -1;

        for (
            let i = 0; i < materials.length; i++
        ) {
            if (
                materials[i].id ===
                id
            ) {
                materialIndex =
                    i;

                break;
            }
        }

        if (
            materialIndex ===
            -1
        ) {
            return json(404, {
                error: "Material not found."
            });
        }

        const material =
            materials[
                materialIndex
            ];

        const store =
            getStudyStore();

        // -------------------------------------------------
        // DELETE FILE
        // -------------------------------------------------

        if (
            material.blobKey
        ) {
            try {
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

        // -------------------------------------------------
        // DELETE INDEX RECORD
        // -------------------------------------------------

        materials.splice(
            materialIndex,
            1
        );

        await saveIndex(
            materials
        );

        return json(200, {
            success: true,

            message: "Study material deleted successfully.",

            deleted: material
        });
    } catch (error) {
        console.error(
            "Delete error:",
            error
        );

        return json(500, {
            error: "Unable to delete study material.",

            message: error.message
        });
    }
}

// =====================================================
// OPTIONS
// =====================================================

function handleOptions() {
    return {
        statusCode: 204,

        headers: {
            "Access-Control-Allow-Origin": "*",

            "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",

            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",

            "Access-Control-Max-Age": "86400"
        },

        body: ""
    };
}

// =====================================================
// NETLIFY HANDLER
// =====================================================

exports.handler =
    async function(event) {
        try {
            const method =
                String(
                    event.httpMethod ||
                    "GET"
                ).toUpperCase();

            // OPTIONS
            if (
                method ===
                "OPTIONS"
            ) {
                return handleOptions();
            }

            // GET
            if (
                method ===
                "GET"
            ) {
                return await handleGet(
                    event
                );
            }

            // POST
            if (
                method ===
                "POST"
            ) {
                return await handleUpload(
                    event
                );
            }

            // DELETE
            if (
                method ===
                "DELETE"
            ) {
                return await handleDelete(
                    event
                );
            }

            // OTHER
            return json(405, {
                error: "Method not allowed."
            });
        } catch (error) {
            console.error(
                "StudyShare API error:",
                error
            );

            return json(500, {
                error: error.message ||
                    "Server error."
            });
        }
    };