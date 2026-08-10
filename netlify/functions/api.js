const { getStore, connectLambda } = require("@netlify/blobs");
const Busboy = require("busboy");
const crypto = require("crypto");

// =====================================================
// CONFIGURATION
// =====================================================

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

function fileResponse(
    statusCode,
    contentType,
    body,
    filename
) {
    return {
        statusCode: statusCode,

        isBase64Encoded: true,

        headers: {
            "Content-Type": contentType ||
                "application/octet-stream",

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

    const headers =
        event.headers || {};

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

    if (
        suppliedPassword !==
        expectedPassword
    ) {

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

    const store =
        getStudyStore();

    try {

        const data =
            await store.get(
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

    const store =
        getStudyStore();

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
        .substring(
            0,
            150
        );
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

                if (
                    headers["content-type"]
                ) {

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


                // ---------------------------------------------
                // TEXT FIELDS
                // ---------------------------------------------

                busboy.on(
                    "field",
                    function(
                        name,
                        value
                    ) {

                        fields[name] =
                            value;
                    }
                );


                // ---------------------------------------------
                // FILE
                // ---------------------------------------------

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


                // ---------------------------------------------
                // FINISH
                // ---------------------------------------------

                busboy.on(
                    "finish",
                    function() {

                        if (
                            fileTooLarge
                        ) {

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


                // ---------------------------------------------
                // REQUEST BODY
                // ---------------------------------------------

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
// EXTRACT MATERIAL ID FROM FILE URL
// =====================================================

function getMaterialIdFromPath(event) {

    const path =
        String(
            event.path || ""
        );

    const marker =
        "/file/";

    const index =
        path.indexOf(marker);

    if (index === -1) {
        return "";
    }

    const value =
        path.substring(
            index + marker.length
        );

    if (!value) {
        return "";
    }

    return decodeURIComponent(
        value.split("/")[0]
    );
}


// =====================================================
// GET MATERIALS / GET FILE
// =====================================================

async function handleGet(event) {

    const query =
        event.queryStringParameters || {};

    const store =
        getStudyStore();


    // =================================================
    // GET FILE
    //
    // Supports:
    //
    // ?file=<blobKey>
    //
    // AND:
    //
    // /file/<material-id>
    // =================================================

    let blobKey =
        query.file || "";


    // ---------------------------------------------
    // IF NO ?file= PARAMETER
    // CHECK /file/<id>
    // ---------------------------------------------

    if (!blobKey) {

        const materialId =
            getMaterialIdFromPath(
                event
            );

        if (materialId) {

            const materials =
                await readIndex();

            const material =
                materials.find(
                    function(item) {

                        return (
                            item.id ===
                            materialId
                        );
                    }
                );


            if (!material) {

                return json(
                    404, {
                        error: "Material not found."
                    }
                );
            }


            blobKey =
                material.blobKey;
        }
    }


    // =================================================
    // RETURN ACTUAL FILE
    // =================================================

    if (blobKey) {

        try {

            const arrayBuffer =
                await store.get(
                    blobKey, {
                        type: "arrayBuffer"
                    }
                );


            if (!arrayBuffer) {

                return json(
                    404, {
                        error: "File not found."
                    }
                );
            }


            // -----------------------------------------
            // FIND MATERIAL INFORMATION
            // -----------------------------------------

            const materials =
                await readIndex();

            let material =
                null;


            for (
                let i = 0; i < materials.length; i++
            ) {

                if (
                    materials[i].blobKey ===
                    blobKey
                ) {

                    material =
                        materials[i];

                    break;
                }
            }


            // -----------------------------------------
            // MIME TYPE
            // -----------------------------------------

            let contentType =
                "application/octet-stream";


            let filename =
                "study-material";


            if (material) {

                if (
                    material.mimeType
                ) {

                    contentType =
                        material.mimeType;
                }


                if (
                    material.fileName
                ) {

                    filename =
                        material.fileName;
                }
            }


            // -----------------------------------------
            // RETURN FILE
            // -----------------------------------------

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


            return json(
                500, {
                    error: "Unable to retrieve file.",

                    message: error.message
                }
            );
        }
    }


    // =================================================
    // GET ALL MATERIALS
    // =================================================

    try {

        let materials =
            await readIndex();


        // ---------------------------------------------
        // SEARCH
        // ---------------------------------------------

        const search =
            typeof query.search ===
            "string"

        ?
        query.search
            .trim()
            .toLowerCase()

        :
        "";


        // ---------------------------------------------
        // CATEGORY
        // ---------------------------------------------

        const category =
            typeof query.category ===
            "string"

        ?
        query.category
            .trim()
            .toLowerCase()

        :
        "";


        // ---------------------------------------------
        // FILTER SEARCH
        // ---------------------------------------------

        if (search) {

            materials =
                materials.filter(
                    function(item) {

                        const title =
                            String(
                                item.title ||
                                ""
                            )
                            .toLowerCase();


                        const description =
                            String(
                                item.description ||
                                ""
                            )
                            .toLowerCase();


                        const itemCategory =
                            String(
                                item.category ||
                                ""
                            )
                            .toLowerCase();


                        const fileName =
                            String(
                                item.fileName ||
                                ""
                            )
                            .toLowerCase();


                        return (
                            title.includes(
                                search
                            ) ||

                            description.includes(
                                search
                            ) ||

                            itemCategory.includes(
                                search
                            ) ||

                            fileName.includes(
                                search
                            )
                        );
                    }
                );
        }


        // ---------------------------------------------
        // FILTER CATEGORY
        // ---------------------------------------------

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
                            )
                            .toLowerCase() ===
                            category
                        );
                    }
                );
        }


        // ---------------------------------------------
        // NEWEST FIRST
        // ---------------------------------------------

        materials.sort(
            function(a, b) {

                return (
                    new Date(
                        b.createdAt ||
                        0
                    ) -

                    new Date(
                        a.createdAt ||
                        0
                    )
                );
            }
        );


        // ---------------------------------------------
        // RESPONSE
        // ---------------------------------------------

        return json(
            200, {
                success: true,

                count: materials.length,

                materials: materials
            }
        );


    } catch (error) {

        console.error(
            "GET error:",
            error
        );


        return json(
            500, {
                error: "Unable to load study materials.",

                message: error.message
            }
        );
    }
}


// =====================================================
// UPLOAD
// =====================================================

async function handleUpload(event) {

    // ---------------------------------------------
    // CHECK ADMIN PASSWORD
    // ---------------------------------------------

    const auth =
        checkPassword(event);


    if (!auth.ok) {
        return auth.response;
    }


    try {

        // -----------------------------------------
        // PARSE FORM
        // -----------------------------------------

        const parsed =
            await parseMultipart(
                event
            );


        const fields =
            parsed.fields;


        const file =
            parsed.file;


        // -----------------------------------------
        // CHECK FILE
        // -----------------------------------------

        if (!file) {

            return json(
                400, {
                    error: "No file was uploaded."
                }
            );
        }


        if (!file.buffer ||
            file.buffer.length === 0
        ) {

            return json(
                400, {
                    error: "Uploaded file is empty."
                }
            );
        }


        if (
            file.buffer.length >
            MAX_FILE_SIZE
        ) {

            return json(
                400, {
                    error: "File is larger than 5 MB."
                }
            );
        }


        // -----------------------------------------
        // FORM DATA
        // -----------------------------------------

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

            return json(
                400, {
                    error: "Title is required."
                }
            );
        }


        // -----------------------------------------
        // CREATE ID
        // -----------------------------------------

        const id =
            createId();


        // -----------------------------------------
        // FILE NAME
        // -----------------------------------------

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


        // -----------------------------------------
        // BLOB KEY
        // -----------------------------------------

        const blobKey =
            "files/" +
            id +
            "-" +
            cleanFileName;


        // -----------------------------------------
        // SAVE FILE TO NETLIFY BLOBS
        // -----------------------------------------

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


        // -----------------------------------------
        // CREATE MATERIAL RECORD
        // -----------------------------------------

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


        // -----------------------------------------
        // SAVE MATERIAL INDEX
        // -----------------------------------------

        const materials =
            await readIndex();


        materials.unshift(
            material
        );


        await saveIndex(
            materials
        );


        // -----------------------------------------
        // SUCCESS
        // -----------------------------------------

        return json(
            201, {
                success: true,

                message: "Study material uploaded successfully.",

                material: material
            }
        );


    } catch (error) {

        console.error(
            "Upload error:",
            error
        );


        return json(
            500, {
                error: "Unable to upload study material.",

                message: error.message
            }
        );
    }
}


// =====================================================
// DELETE
// =====================================================

async function handleDelete(event) {

    // ---------------------------------------------
    // CHECK ADMIN PASSWORD
    // ---------------------------------------------

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


        // -----------------------------------------
        // ALSO CHECK REQUEST BODY
        // -----------------------------------------

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
                    JSON.parse(
                        body
                    );


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


        // -----------------------------------------
        // CHECK ID
        // -----------------------------------------

        if (!id) {

            return json(
                400, {
                    error: "Material ID is required."
                }
            );
        }


        // -----------------------------------------
        // FIND MATERIAL
        // -----------------------------------------

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
            materialIndex === -1
        ) {

            return json(
                404, {
                    error: "Material not found."
                }
            );
        }


        const material =
            materials[
                materialIndex
            ];


        const store =
            getStudyStore();


        // -----------------------------------------
        // DELETE BLOB FILE
        // -----------------------------------------

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


        // -----------------------------------------
        // DELETE INDEX RECORD
        // -----------------------------------------

        materials.splice(
            materialIndex,
            1
        );


        await saveIndex(
            materials
        );


        // -----------------------------------------
        // SUCCESS
        // -----------------------------------------

        return json(
            200, {
                success: true,

                message: "Study material deleted successfully.",

                deleted: material
            }
        );


    } catch (error) {

        console.error(
            "Delete error:",
            error
        );


        return json(
            500, {
                error: "Unable to delete study material.",

                message: error.message
            }
        );
    }
}


// =====================================================
// OPTIONS / CORS
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

        // Connect Lambda to Netlify Blobs
        connectLambda(event);


        try {

            const method =
                String(
                    event.httpMethod ||
                    "GET"
                ).toUpperCase();


            // -----------------------------------------
            // OPTIONS
            // -----------------------------------------

            if (
                method ===
                "OPTIONS"
            ) {

                return handleOptions();
            }


            // -----------------------------------------
            // GET
            // -----------------------------------------

            if (
                method ===
                "GET"
            ) {

                return await handleGet(
                    event
                );
            }


            // -----------------------------------------
            // POST
            // -----------------------------------------

            if (
                method ===
                "POST"
            ) {

                return await handleUpload(
                    event
                );
            }


            // -----------------------------------------
            // DELETE
            // -----------------------------------------

            if (
                method ===
                "DELETE"
            ) {

                return await handleDelete(
                    event
                );
            }


            // -----------------------------------------
            // OTHER METHODS
            // -----------------------------------------

            return json(
                405, {
                    error: "Method not allowed."
                }
            );


        } catch (error) {

            console.error(
                "StudyShare API error:",
                error
            );


            return json(
                500, {
                    error: error.message ||
                        "Server error."
                }
            );
        }
    };