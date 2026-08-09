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


// ======================================================
// HTML ESCAPE
// ======================================================

function esc(value = "") {
    return String(value).replace(/[&<>"']/g, char => {
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


// ======================================================
// LOAD MATERIALS
// ======================================================

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
                `Server returned ${response.status}`
            );
        }

        const data = await response.json();

        console.log("StudyShare API response:", data);

        // API may return array directly
        if (Array.isArray(data)) {
            materials = data;
        }

        // Or { materials: [...] }
        else if (Array.isArray(data.materials)) {
            materials = data.materials;
        } else {
            materials = [];
        }

        render();

    } catch (error) {

        console.error("Load materials error:", error);

        materialsEl.innerHTML = `
            <div class="loading">
                ❌ Unable to load study material.
                <br>
                <small>${esc(error.message)}</small>
            </div>
        `;
    }
}


// ======================================================
// FILE URL
// ======================================================

function fileUrl(id) {

    return `${API_BASE}/file/${encodeURIComponent(id)}`;
}


// ======================================================
// RENDER MATERIALS
// ======================================================

function render() {

    const query =
        searchEl.value.toLowerCase().trim();

    const category =
        categoryEl.value;

    const filtered = materials.filter(material => {

        const title =
            String(material.title || "").toLowerCase();

        const description =
            String(material.description || "").toLowerCase();

        const materialCategory =
            String(material.category || "");

        const matchesSearch = !query ||
            title.includes(query) ||
            description.includes(query) ||
            materialCategory.toLowerCase().includes(query);

        const matchesCategory =
            category === "all" ||
            category === "" ||
            materialCategory === category;

        return matchesSearch && matchesCategory;
    });


    if (filtered.length === 0) {

        materialsEl.innerHTML = `
            <div class="loading">
                📚 No study material found.
            </div>
        `;

        return;
    }


    materialsEl.innerHTML = filtered.map(material => {

        const id =
            esc(material.id || "");

        const title =
            esc(material.title || "Untitled material");

        const description =
            esc(material.description || "");

        const categoryText =
            esc(material.category || "Other");

        const fileName =
            esc(
                material.originalFileName ||
                material.fileName ||
                "Study material"
            );

        const mimeType =
            material.mimeType || "";

        const isPdf =
            mimeType === "application/pdf" ||
            String(material.extension || "").toLowerCase() === "pdf";


        return `
            <article class="card" data-id="${id}">

                <div
                    class="preview"
                    id="preview-${id}"
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
                            href="${fileUrl(id)}"
                            target="_blank"
                            rel="noopener"
                        >
                            ${isPdf ? "📖 Open PDF" : "📂 Open File"}
                        </a>

                        <a
                            class="outline-btn"
                            href="${fileUrl(id)}"
                            download="${fileName}"
                        >
                            ⬇️ Download
                        </a>

                        <button
                            class="delete-btn"
                            data-delete="${id}"
                        >
                            🗑️ Delete
                        </button>

                    </div>

                </div>

            </article>
        `;

    }).join("");


    // ==================================================
    // LOAD PDF PREVIEWS
    // ==================================================

    filtered.forEach(async material => {

        const preview =
            document.getElementById(
                `preview-${material.id}`
            );

        if (!preview) {
            return;
        }

        try {

            const url =
                fileUrl(material.id);

            if (
                material.mimeType === "application/pdf" ||
                String(material.extension || "").toLowerCase() === "pdf"
            ) {

                preview.innerHTML = `
                    <iframe
                        src="${url}"
                        title="${esc(material.title || "PDF preview")}"
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


    // ==================================================
    // DELETE BUTTONS
    // ==================================================

    document
        .querySelectorAll("[data-delete]")
        .forEach(button => {

            button.onclick = () => {

                deleteMaterial(
                    button.dataset.delete
                );

            };

        });
}


// ======================================================
// DELETE MATERIAL
// ======================================================

async function deleteMaterial(id) {

    if (!adminPassword) {

        alert(
            "Please open Admin and enter the admin password first."
        );

        return;
    }


    if (!confirm(
            "Are you sure you want to delete this material?"
        )) {
        return;
    }


    try {

        const response = await fetch(
            `${API_BASE}/${encodeURIComponent(id)}`, {
                method: "DELETE",

                headers: {
                    "X-Admin-Password": adminPassword
                }
            }
        );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Unable to delete material."
            );
        }


        alert("Material deleted successfully.");

        await loadMaterials();


    } catch (error) {

        console.error(
            "Delete error:",
            error
        );

        alert(
            "❌ " + error.message
        );
    }
}


// ======================================================
// SEARCH / CATEGORY
// ======================================================

searchEl.addEventListener(
    "input",
    render
);

categoryEl.addEventListener(
    "change",
    render
);


// ======================================================
// ADMIN MODAL
// ======================================================

adminBtn.onclick = () => {

    adminModal.classList.remove(
        "hidden"
    );
};


closeAdmin.onclick = () => {

    adminModal.classList.add(
        "hidden"
    );
};


// Close when clicking outside modal

adminModal.addEventListener(
    "click",
    event => {

        if (
            event.target === adminModal
        ) {

            adminModal.classList.add(
                "hidden"
            );
        }

    }
);


// ======================================================
// UPLOAD MATERIAL
// ======================================================

uploadForm.onsubmit = async event => {

    event.preventDefault();


    const passwordInput =
        document.getElementById("password");

    adminPassword =
        passwordInput.value;


    const formData =
        new FormData(uploadForm);


    uploadStatus.textContent =
        "Uploading material...";


    try {

        const response = await fetch(
            API_BASE, {
                method: "POST",

                headers: {
                    "X-Admin-Password": adminPassword
                },

                body: formData
            }
        );


        const data =
            await response.json();


        console.log(
            "Upload response:",
            data
        );


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Unable to upload study material."
            );
        }


        uploadStatus.textContent =
            "✅ Material uploaded successfully!";


        uploadForm.reset();


        await loadMaterials();


        setTimeout(() => {

            adminModal.classList.add(
                "hidden"
            );

            uploadStatus.textContent = "";

        }, 1000);


    } catch (error) {

        console.error(
            "Upload error:",
            error
        );

        uploadStatus.textContent =
            "❌ " + error.message;
    }
};


// ======================================================
// START APPLICATION
// ======================================================

loadMaterials();