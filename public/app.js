const API_BASE = "/.netlify/functions/api";

const materialsEl = document.getElementById("materials");
const searchEl = document.getElementById("search");
const categoryEl = document.getElementById("category");

const adminBtn = document.getElementById("adminBtn");
const adminModal = document.getElementById("adminModal");
const closeAdmin = document.getElementById("closeAdmin");
const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");

let materials = [];
let adminPassword = "";


/* ======================================================
   HTML ESCAPE
====================================================== */

function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function(char) {
        const map = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return map[char];
    });
}


/* ======================================================
   LOAD MATERIALS
====================================================== */

async function loadMaterials() {

    materialsEl.innerHTML =
        '<div class="loading">Loading study material...</div>';

    try {

        const response = await fetch(API_BASE, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                "Server returned " + response.status
            );
        }

        const data = await response.json();

        console.log("StudyShare API response:", data);

        if (Array.isArray(data)) {

            materials = data;

        } else if (Array.isArray(data.materials)) {

            materials = data.materials;

        } else {

            materials = [];

        }

        render();

    } catch (error) {

        console.error(
            "Load materials error:",
            error
        );

        materialsEl.innerHTML = `
            <div class="loading">
                ❌ Unable to load study material.
                <br>
                <small>${esc(error.message)}</small>
            </div>
        `;
    }
}


/* ======================================================
   FILE URL
====================================================== */

function fileUrl(id) {

    return (
        API_BASE +
        "/file/" +
        encodeURIComponent(id)
    );
}


/* ======================================================
   RENDER MATERIALS
====================================================== */

function render() {

    const query =
        String(searchEl.value || "")
        .toLowerCase()
        .trim();

    const category =
        categoryEl.value || "all";


    const filtered = materials.filter(function(material) {

        const title =
            String(material.title || "")
            .toLowerCase();

        const description =
            String(material.description || "")
            .toLowerCase();

        const materialCategory =
            String(material.category || "");


        const fileName =
            String(
                material.originalFileName ||
                material.fileName ||
                ""
            ).toLowerCase();


        const matchesSearch = !query ||
            title.includes(query) ||
            description.includes(query) ||
            materialCategory
            .toLowerCase()
            .includes(query) ||
            fileName.includes(query);


        const matchesCategory =
            category === "all" ||
            category === "" ||
            materialCategory === category;


        return (
            matchesSearch &&
            matchesCategory
        );
    });


    if (filtered.length === 0) {

        materialsEl.innerHTML = `
            <div class="loading">
                📚 No study material found.
            </div>
        `;

        return;
    }


    /* ==================================================
       CREATE MATERIAL CARDS
    ================================================== */

    materialsEl.innerHTML = filtered.map(function(material) {

        /*
         * IMPORTANT:
         * Keep the original ID.
         * Do NOT HTML-escape the ID before using it
         * in fileUrl() or deleteMaterial().
         */

        const materialId =
            String(material.id || "").trim();


        const idForHtml =
            esc(materialId);


        const title =
            esc(
                material.title ||
                "Untitled material"
            );


        const description =
            esc(
                material.description || ""
            );


        const categoryText =
            esc(
                material.category ||
                "Other"
            );


        const fileName =
            esc(
                material.originalFileName ||
                material.fileName ||
                "Study material"
            );


        const mimeType =
            String(
                material.mimeType || ""
            ).toLowerCase();


        const extension =
            String(
                material.extension || ""
            ).toLowerCase();


        const isPdf =
            mimeType === "application/pdf" ||
            extension === "pdf";


        const previewId =
            "preview-" +
            encodeURIComponent(materialId);


        return `
            <article
                class="card"
                data-id="${idForHtml}"
            >

                <div
                    class="preview"
                    id="${previewId}"
                >
                    <div class="loading">
                        Loading preview...
                    </div>
                </div>


                <div class="card-body">

                    <span class="pill">
                        ${categoryText}
                    </span>


                    <h3>
                        ${title}
                    </h3>


                    <p>
                        ${description}
                    </p>


                    <small>
                        📄 ${fileName}
                    </small>


                    <div class="card-actions">

                        <a
                            class="primary-btn"
                            href="${fileUrl(materialId)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            ${
                                isPdf
                                    ? "📖 Open PDF"
                                    : "📂 Open File"
                            }
                        </a>


                        <a
                            class="outline-btn"
                            href="${fileUrl(materialId)}"
                            download="${fileName}"
                        >
                            ⬇️ Download
                        </a>


                        <button
                            type="button"
                            class="delete-btn"
                            data-delete="${idForHtml}"
                        >
                            🗑️ Delete
                        </button>

                    </div>

                </div>

            </article>
        `;

    }).join("");


    /* ==================================================
       LOAD PDF PREVIEWS
    ================================================== */

    filtered.forEach(function(material) {

        const materialId =
            String(material.id || "").trim();


        const previewId =
            "preview-" +
            encodeURIComponent(materialId);


        const preview =
            document.getElementById(previewId);


        if (!preview) {
            return;
        }


        try {

            const url =
                fileUrl(materialId);


            const mimeType =
                String(
                    material.mimeType || ""
                ).toLowerCase();


            const extension =
                String(
                    material.extension || ""
                ).toLowerCase();


            const isPdf =
                mimeType === "application/pdf" ||
                extension === "pdf";


            if (isPdf) {

                preview.innerHTML = `
                    <iframe
                        src="${url}"
                        title="${esc(
                            material.title ||
                            "PDF preview"
                        )}"
                        loading="lazy"
                    ></iframe>
                `;

            } else {

                preview.innerHTML = `
                    <div class="file-preview">
                        📄
                    </div>
                `;
            }


        } catch (error) {

            console.error(
                "Preview error:",
                error
            );


            preview.innerHTML = `
                <div class="file-preview">
                    📄
                </div>
            `;
        }

    });


    /* ==================================================
       DELETE BUTTONS
    ================================================== */

    document
        .querySelectorAll("[data-delete]")
        .forEach(function(button) {

            button.addEventListener(
                "click",
                function() {

                    /*
                     * Get the ID directly from the
                     * clicked material card.
                     */

                    const materialId =
                        String(
                            button.getAttribute(
                                "data-delete"
                            ) || ""
                        ).trim();


                    if (!materialId) {

                        alert(
                            "❌ Material ID is missing."
                        );

                        return;
                    }


                    console.log(
                        "Deleting material:",
                        materialId
                    );


                    deleteMaterial(
                        materialId
                    );

                }
            );

        });
}


/* ======================================================
   DELETE MATERIAL
====================================================== */

async function deleteMaterial(id) {

    id = String(id || "").trim();


    /* --------------------------------------------------
       CHECK MATERIAL ID
    -------------------------------------------------- */

    if (!id) {

        alert(
            "❌ Material ID is required."
        );

        return;
    }


    /* --------------------------------------------------
       CHECK ADMIN PASSWORD
    -------------------------------------------------- */

    if (!adminPassword) {

        alert(
            "Please open Admin and enter the admin password first."
        );

        return;
    }


    /* --------------------------------------------------
       CONFIRM DELETE
    -------------------------------------------------- */

    const confirmed =
        confirm(
            "Are you sure you want to delete this material?"
        );


    if (!confirmed) {
        return;
    }


    try {

        console.log(
            "Deleting material ID:",
            id
        );


        /*
         * IMPORTANT:
         *
         * Send the Material ID in:
         *
         * 1. URL path
         * 2. ?id= query parameter
         * 3. X-Material-ID header
         *
         * This makes the frontend compatible with
         * the DELETE handler expecting the ID in
         * different locations.
         */

        const deleteUrl =
            API_BASE +
            "/" +
            encodeURIComponent(id) +
            "?id=" +
            encodeURIComponent(id);


        const response =
            await fetch(
                deleteUrl, {
                    method: "DELETE",

                    headers: {
                        "Content-Type": "application/json",

                        "X-Admin-Password": adminPassword,

                        "X-Material-ID": id
                    }
                }
            );


        const responseText =
            await response.text();


        let data = {};

        try {

            data =
                JSON.parse(
                    responseText
                );

        } catch {

            data = {
                error: responseText ||
                    "Unknown server response."
            };
        }


        console.log(
            "Delete response:",
            data
        );


        if (!response.ok) {

            throw new Error(
                data.error ||
                data.message ||
                "Unable to delete material."
            );
        }


        alert(
            "✅ Material deleted successfully."
        );


        /*
         * Reload materials so the deleted
         * card immediately disappears.
         */

        await loadMaterials();


    } catch (error) {

        console.error(
            "Delete error:",
            error
        );


        alert(
            "❌ Delete failed: " +
            error.message
        );
    }
}


/* ======================================================
   SEARCH
====================================================== */

searchEl.addEventListener(
    "input",
    function() {
        render();
    }
);


/* ======================================================
   CATEGORY
====================================================== */

categoryEl.addEventListener(
    "change",
    function() {
        render();
    }
);


/* ======================================================
   ADMIN MODAL
====================================================== */

adminBtn.addEventListener(
    "click",
    function() {

        adminModal.classList.remove(
            "hidden"
        );

    }
);


/* ======================================================
   CLOSE ADMIN
====================================================== */

closeAdmin.addEventListener(
    "click",
    function() {

        adminModal.classList.add(
            "hidden"
        );

    }
);


/* ======================================================
   CLOSE MODAL OUTSIDE
====================================================== */

adminModal.addEventListener(
    "click",
    function(event) {

        if (
            event.target === adminModal
        ) {

            adminModal.classList.add(
                "hidden"
            );

        }

    }
);


/* ======================================================
   UPLOAD MATERIAL
====================================================== */

uploadForm.addEventListener(
    "submit",
    async function(event) {

        event.preventDefault();


        const passwordInput =
            document.getElementById(
                "password"
            );


        adminPassword =
            String(
                passwordInput.value || ""
            );


        if (!adminPassword) {

            uploadStatus.textContent =
                "❌ Please enter the admin password.";

            return;
        }


        const formData =
            new FormData(
                uploadForm
            );


        uploadStatus.textContent =
            "Uploading material...";


        try {

            const response =
                await fetch(
                    API_BASE, {
                        method: "POST",

                        headers: {
                            "X-Admin-Password": adminPassword
                        },

                        body: formData
                    }
                );


            const responseText =
                await response.text();


            let data = {};

            try {

                data =
                    JSON.parse(
                        responseText
                    );

            } catch {

                data = {
                    error: responseText ||
                        "Unknown server response."
                };
            }


            console.log(
                "Upload response:",
                data
            );


            if (!response.ok) {

                throw new Error(
                    data.error ||
                    data.message ||
                    "Unable to upload study material."
                );
            }


            uploadStatus.textContent =
                "✅ Material uploaded successfully!";


            uploadForm.reset();


            /*
             * Reload materials immediately.
             */

            await loadMaterials();


            /*
             * Close admin modal after upload.
             */

            setTimeout(
                function() {

                    adminModal.classList.add(
                        "hidden"
                    );

                    uploadStatus.textContent =
                        "";

                },
                1000
            );


        } catch (error) {

            console.error(
                "Upload error:",
                error
            );


            uploadStatus.textContent =
                "❌ " +
                error.message;
        }

    }
);


/* ======================================================
   START APPLICATION
====================================================== */

loadMaterials();