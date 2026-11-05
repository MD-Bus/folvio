const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let username = "",
  current = null,
  folder = null,
  publicMode = location.pathname.startsWith("/s/"),
  base = "",
  tab = "files",
  filesAfter = "",
  allFiles = [],
  busy = false;
const logo = '<div class="logo"><span class="mark">ƒ</span> Folvio</div>';
const bytes = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + " GB"
    : n >= 1e6
      ? (n / 1e6).toFixed(1) + " MB"
      : n >= 1000 ? (n / 1000).toFixed(1) + " KB" : n + " B";
function notice(s) {
  document.querySelector("#notice").textContent = s;
  setTimeout(() => (document.querySelector("#notice").textContent = ""), 6000);
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api/" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Request failed");
  return b;
}
function bind(id, event, fn) {
  document.getElementById(id)?.addEventListener(event, async (e) => {
    try {
      if (busy) {
        e.preventDefault();
        return notice("Wait for uploads to finish.");
      }
      await fn(e);
    } catch (error) {
      notice(error.message);
    }
  });
}
function modal(title, content, submit) {
  dialog.innerHTML = `<form id="modal-form"><h2>${escape(title)}</h2>${content}<p class="error" id="modal-error"></p><div class="actions"><button class="primary">Save</button><button type="button" id="cancel">Cancel</button></div></form>`;
  dialog.showModal();
  bind("cancel", "click", () => dialog.close());
  document.querySelector("#modal-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await submit(new FormData(e.target));
      dialog.close();
    } catch (error) {
      document.querySelector("#modal-error").textContent = error.message;
    }
  };
}
function shell(content, active = "collections") {
  app.innerHTML = `<aside class="sidebar">${logo}<nav><button id="nav-collections" class="${active === "collections" ? "active" : ""}">▣ Collections</button><button id="nav-api" class="${active === "api" ? "active" : ""}">⌘ API keys</button></nav><div class="account"><div><strong>${escape(username)}</strong><small>Administrator</small></div><button id="theme">◐ Theme</button> <button id="logout">Log out</button></div></aside><main class="main">${content}</main>`;
  bind("nav-collections", "click", () => list());
  bind("nav-api", "click", keys);
  bind("theme", "click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem(
      "theme",
      document.body.classList.contains("dark") ? "dark" : "light",
    );
  });
  bind("logout", "click", async () => {
    await api("session", "DELETE");
    location.href = "/";
  });
}
async function login() {
  const session = await api("session");
  if (session.username) {
    username = session.username;
    return list();
  }
  app.innerHTML = `<main class="login">${logo}<h1>${session.configured ? "Sign in to Folvio" : "One last step"}</h1><p class="muted">${session.configured ? "Your collections, files, and clients in one place." : "Add ADMIN_USERNAME and ADMIN_PASSWORD as Worker secrets in Cloudflare, then refresh this page."}</p>${session.configured ? '<form id="login"><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><p class="error" id="login-error"></p><button class="primary">Sign in</button></form>' : '<button id="refresh">Check again</button>'}</main>`;
  bind("refresh", "click", login);
  bind("login", "submit", async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      await api("session", "POST", Object.fromEntries(new FormData(e.target)));
      await login();
    } catch (error) {
      document.querySelector("#login-error").textContent = error.message;
    } finally {
      b.disabled = false;
    }
  });
}
async function list(after = "", previous = []) {
  current = null;
  const page = await api("collections" + (after ? "?after=" + after : "")),
    more = page.length > 50,
    items = [...previous, ...page.slice(0, 50)];
  shell(
    `<header class="top"><div><h1>Collections</h1><span class="muted">A clear place for every file you need.</span></div><button class="primary" id="new">＋ New collection</button></header><div class="grid">${items.map((c) => `<button class="card" data-collection="${c.id}"><span class="badge">COLLECTION</span><h2>${escape(c.name)}</h2><p class="muted">${escape(c.description || "Open collection →")}</p></button>`).join("")}</div>${!items.length ? '<div class="panel empty">Create your first collection, arrange its folders, then share a secure link.</div>' : ""}${more ? '<button id="more">Load more</button>' : ""}`,
  );
  bind("new", "click", () => wizard());
  bind("more", "click", () => list(items.at(-1).id, items));
  document
    .querySelectorAll("[data-collection]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          openCollection(el.dataset.collection).catch((e) =>
            notice(e.message),
          )),
    );
}
let draft = {},
  step = 0,
  draftFolders = [];
function wizard(next = 0) {
  step = next;
  const labels = [
    "Details",
    "Upload limits",
    "Folders",
    "Permissions",
    "Share",
  ];
  const checked = (k) => (draft[k] ? "checked" : "");
  let content =
    step === 0
      ? `<label>Collection name<input name="name" required value="${escape(draft.name)}" placeholder="Harbor Studio"></label><label>Description<textarea name="description">${escape(draft.description)}</textarea></label>`
      : step === 1
        ? `<label>Collection password (optional)<input name="password" type="password" value="${escape(draft.password)}" autocomplete="new-password"></label><label>Expires (optional)<input name="expiry" type="datetime-local" value="${escape(draft.expiry)}"></label><label>Storage limit (MB)<input name="quota_mb" type="number" min="1" max="8000" value="${draft.quota_mb || 1000}" required></label><label>Maximum file size (MB)<input name="file_mb" type="number" min="1" max="2000" value="${draft.file_mb || 100}" required></label>`
        : step === 2
          ? `<p class="muted">Prepare the folders recipients will see. Select a folder to rename, move, or delete it.</p><div id="draft-tree" class="tree"></div><button type="button" id="draft-add">＋ Add folder</button>`
          : step === 3
            ? `<label class="check"><input type="checkbox" name="upload" ${draft.upload !== false ? "checked" : ""}>Allow uploads</label><label class="check"><input type="checkbox" name="create_folder" ${checked("create_folder")}>Allow recipients to create folders</label><label class="check"><input type="checkbox" name="rename_own" ${checked("rename_own")}>Allow recipients to rename their own folders</label><small>Folder-specific overrides are available in the folder manager. Recipients can never move or delete folders.</small>`
            : `<h2>${escape(draft.name)}</h2><p>Your folder structure and recipient permissions are ready.</p><p class="muted">${draftFolders.length} prepared folders<br>Folder creation: ${draft.create_folder ? "Enabled" : "Disabled"}</p>`;
  shell(
    `<header class="top"><h1>New collection</h1><button id="close-wizard">Cancel</button></header><div class="steps">${labels.map((x, i) => (i === step ? `<strong>${i + 1}. ${x}</strong>` : `<span>${i + 1}. ${x}</span>`)).join("")}</div><form id="wizard" class="panel form">${content}<div class="actions">${step ? '<button type="button" id="back">Back</button>' : ""}<button class="primary">${step === 4 ? "Create collection" : "Continue"}</button></div></form>`,
  );
  if (step === 2) draftTree();
  bind("close-wizard", "click", () => {
    draft = {};
    draftFolders = [];
    return list();
  });
  bind("back", "click", () => wizard(step - 1));
  bind("wizard", "submit", async (e) => {
    e.preventDefault();
    Object.assign(draft, Object.fromEntries(new FormData(e.target)));
    if (step === 3)
      for (const k of ["upload", "create_folder", "rename_own"])
        draft[k] = e.target.elements[k].checked;
    if (step < 4) return wizard(step + 1);
    e.target.querySelector(".primary").disabled = true;
    const created = await api("collections", "POST", {
      name: draft.name,
      description: draft.description,
      password: draft.password || "",
      expires: draft.expiry ? new Date(draft.expiry).getTime() : null,
      quota: Number(draft.quota_mb) * 1e6,
      max_file: Number(draft.file_mb) * 1e6,
      upload: draft.upload,
      create_folder: draft.create_folder,
      rename_own: draft.rename_own,
    });
    const saved = new Map();
    try {
      for (const f of draftFolders) {
        const result = await api(`collections/${created.id}/folders`, "POST", {
          name: f.name,
          parent: f.parent ? saved.get(f.parent) : null,
        });
        saved.set(f.id, result.id);
      }
    } catch (error) {
      notice(
        "Collection saved; some folders could not be created: " + error.message,
      );
    }
    draftFolders = [];
    draft = {};
    await openCollection(created.id);
    share();
  });
}

function draftTree() {
  const render = (parent = null, depth = 0) =>
    draftFolders
      .filter((f) => f.parent === parent)
      .map(
        (f) =>
          `<button type="button" data-draft="${f.id}">${"　".repeat(depth)}▱ ${escape(f.name)}</button>${render(f.id, depth + 1)}`,
      )
      .join("");
  document.querySelector("#draft-tree").innerHTML =
    render() || '<p class="muted">No folders yet.</p>';
  const edit = (f) =>
    modal(
      f ? "Edit folder" : "Add folder",
      `<label>Name<input name="name" required value="${escape(f?.name)}"></label><label>Parent folder<select name="parent"><option value="">Collection root</option>${draftFolders
        .filter((x) => x.id !== f?.id)
        .map(
          (x) =>
            `<option value="${x.id}" ${f?.parent === x.id ? "selected" : ""}>${escape(x.name)}</option>`,
        )
        .join(
          "",
        )}</select></label>${f ? '<button type="button" id="draft-delete" class="danger">Delete empty folder</button>' : ""}`,
      async (data) => {
        const parent = data.get("parent") || null;
        let cursor = parent;
        while (cursor) {
          if (cursor === f?.id)
            throw Error("Cannot move a folder inside itself.");
          cursor = draftFolders.find((x) => x.id === cursor)?.parent;
        }
        const name = data.get("name").trim();
        if (!name || /[\/]/.test(name))
          throw Error("Enter a folder name without slashes.");
        if (
          draftFolders.some(
            (x) => x.id !== f?.id && x.parent === parent && x.name === name,
          )
        )
          throw Error("A folder with that name already exists.");
        if (f) {
          f.name = name;
          f.parent = parent;
        } else draftFolders.push({ id: crypto.randomUUID(), name, parent });
        const sorted = [];
        const walk = (p) => {
          for (const x of draftFolders.filter((x) => x.parent === p)) {
            sorted.push(x);
            walk(x.id);
          }
        };
        walk(null);
        draftFolders = sorted;
        draftTree();
      },
    );
  bind("draft-add", "click", () => edit(null));
  document.querySelectorAll("[data-draft]").forEach(
    (el) =>
      (el.onclick = () => {
        const f = draftFolders.find((x) => x.id === el.dataset.draft);
        edit(f);
        bind("draft-delete", "click", () => {
          if (draftFolders.some((x) => x.parent === f.id))
            throw Error("Delete or move subfolders first.");
          draftFolders = draftFolders.filter((x) => x.id !== f.id);
          dialog.close();
          draftTree();
        });
      }),
  );
}

async function openCollection(id) {
  base = (publicMode ? "share/" : "collections/") + id;
  folder = null;
  tab = "files";
  await refresh();
}
async function refresh() {
  current = await api(base);
  if (folder && !current.folders.some((f) => f.id === folder)) folder = null;
  if (publicMode && !folder) folder = current.folder_root || null;
  await renderCollection();
}
function tree(parent = null, depth = 0) {
  return current.folders
    .filter((f) => f.parent === parent)
    .map(
      (f) =>
        `<button data-folder="${f.id}" class="${folder === f.id ? "selected" : ""}">${"　".repeat(depth)}▱ ${escape(f.name)} ${f.hidden ? "◌" : ""}</button>${tree(f.id, depth + 1)}`,
    )
    .join("");
}
async function renderCollection() {
  const f = current.folders.find((x) => x.id === folder),
    perm = f?.permissions || current.permissions;
  const content = `<header class="top"><div><h1>${escape(current.name)}</h1><span class="muted">${escape(current.description)}</span></div>${!publicMode ? '<button id="share">Share collection ↗</button>' : ""}</header>${!publicMode ? `<div class="tabs"><button id="files-tab" class="${tab === "files" ? "active" : ""}">Files & folders</button><button id="settings-tab" class="${tab === "settings" ? "active" : ""}">Collection settings</button></div>` : ""}${tab === "settings" ? '<div id="settings"></div>' : `<div class="split"><section class="panel tree"><h2>Folders</h2><button data-folder="${current.folder_root || ""}" class="${folder === (current.folder_root || null) ? "selected" : ""}">▱ ${escape(current.name)}</button>${tree(current.folder_root || null)}${!publicMode || perm.create_folder ? '<button id="add-folder">＋ Add folder here</button>' : ""}</section><section class="panel"><div class="top"><h2>${escape(f?.name || "Collection root")}</h2><div class="actions">${!publicMode && f ? '<button id="folder-link">Create upload link</button><button id="folder-links">Manage links</button>' : ""}${f && (!publicMode || (f.own && perm.rename_own)) ? '<button id="edit-folder">' + (publicMode ? "Rename" : "Manage folder") + "</button>" : ""}</div></div>${!publicMode || perm.upload ? '<div class="upload"><label for="upload">Add files to this folder</label><input id="upload" type="file" multiple><small>Files upload securely through Folvio. Maximum ' + bytes(current.max_file) + ' each.</small><progress id="progress" value="0" max="100" hidden></progress><small id="upload-status"></small></div>' : '<p class="muted">This folder is read-only.</p>'}<div id="file-list"></div></section></div>`}`;
  if (publicMode)
    app.innerHTML = `<main class="public">${logo}${content}</main>`;
  else shell(content);
  bind("share", "click", share);
  bind("files-tab", "click", () => {
    tab = "files";
    return renderCollection();
  });
  bind("settings-tab", "click", () => {
    tab = "settings";
    return renderCollection();
  });
  if (tab === "settings") return settingsForm();
  document.querySelectorAll("[data-folder]").forEach(
    (el) =>
      (el.onclick = async () => {
        if (busy) return notice("Wait for uploads to finish.");
        folder = el.dataset.folder || null;
        await renderCollection();
      }),
  );
  bind("add-folder", "click", () =>
    modal(
      "New folder",
      '<label>Name<input name="name" required autofocus></label>',
      async (data) => {
        await api(base + "/folders", "POST", {
          name: data.get("name"),
          parent: folder,
        });
        await refresh();
      },
    ),
  );
  bind("edit-folder", "click", () => editFolder(f));
  bind("folder-links", "click", manageFolderLinks);
  bind("folder-link", "click", async () => {
    const link = await api(base + "/links", "POST", { folder });
    share(link.token);
  });
  bind("upload", "change", upload);
  filesAfter = "";
  allFiles = [];
  fileGeneration++;
  selectedFiles.clear();
  fileSearch = "";
  await files();
}
let fileGeneration = 0;
let selectedFiles = new Set(),
  fileView = localStorage.getItem("file-view") || "grid",
  fileSearch = "";
async function files() {
  const generation = fileGeneration;
  const page = await api(
    base + "/files?folder=" + (folder || "") + "&after=" + filesAfter,
  );
  if (generation !== fileGeneration) return;
  allFiles.push(...page.slice(0, 50));
  renderFiles(page.length > 50);
}
function fileDestination(selected) {
  return `<label>Destination<select name="folder"><option value="">Collection root</option>${current.folders.map((f) => `<option value="${f.id}" ${selected === f.id ? "selected" : ""}>${escape(f.name)}</option>`).join("")}</select></label>`;
}
function renderFiles(more = false) {
  const visible = allFiles.filter((f) =>
    f.name.toLowerCase().includes(fileSearch.toLowerCase()),
  );
  document.querySelector("#file-list").innerHTML =
    `${!publicMode ? `<div class="file-toolbar"><input id="file-search" placeholder="Search loaded files" value="${escape(fileSearch)}" aria-label="Search loaded files"><button id="file-view">${fileView === "grid" ? "List view" : "Grid view"}</button></div><div class="actions file-toolbar"><button id="select-all">Select loaded</button><button id="move-selected">Move selected</button><button id="delete-selected" class="danger">Delete selected</button><small>${selectedFiles.size} selected · ${allFiles.length} loaded</small></div>` : ""}<div class="${!publicMode && fileView === "grid" ? "file-grid" : "file-rows"}">${
      visible
        .map((f) => {
          const preview =
            !publicMode &&
            f.size <= 10000000 &&
            /\.(png|jpe?g|gif|webp|avif)$/i.test(f.name);
          return `<article class="file-item"><div class="file-heading">${!publicMode ? `<input type="checkbox" aria-label="Select ${escape(f.name)}" data-select="${f.id}" ${selectedFiles.has(f.id) ? "checked" : ""}>` : ""}${preview ? `<img class="file-preview" loading="lazy" src="/api/${base}/files/${f.id}?preview=1" alt="">` : '<div class="file-icon" aria-hidden="true">▤</div>'}</div><div class="filename"><strong>${escape(f.name)}</strong><small>${bytes(f.size)} · ${new Date(f.created).toLocaleDateString()}</small></div>${!publicMode ? `<div class="actions"><a class="download-button" href="/api/${base}/files/${f.id}?download=1">Download</a><button data-manage="${f.id}">Manage</button></div>` : '<span class="badge">Received</span>'}</article>`;
        })
        .join("") || '<div class="empty">No files here yet.</div>'
    }</div>${more ? '<button id="more-files">Load more</button>' : ""}`;
  bind("file-view", "click", () => {
    fileView = fileView === "grid" ? "list" : "grid";
    localStorage.setItem("file-view", fileView);
    renderFiles(more);
  });
  bind("file-search", "input", (e) => {
    const pos = e.target.selectionStart;
    fileSearch = e.target.value;
    renderFiles(more);
    const input = document.querySelector("#file-search");
    input.focus();
    input.setSelectionRange(pos, pos);
  });
  document.querySelectorAll("[data-select]").forEach(
    (el) =>
      (el.onchange = () => {
        if (el.checked) selectedFiles.add(el.dataset.select);
        else selectedFiles.delete(el.dataset.select);
        renderFiles(more);
      }),
  );
  bind("select-all", "click", () => {
    selectedFiles = new Set(visible.map((f) => f.id));
    renderFiles(more);
  });
  bind("move-selected", "click", () => {
    if (!selectedFiles.size) return notice("Select files first.");
    modal("Move selected files", fileDestination(folder), async (data) => {
      for (const id of selectedFiles)
        await api(base + "/files/" + id, "PATCH", {
          folder: data.get("folder") || null,
        });
      selectedFiles.clear();
      await renderCollection();
    });
  });
  bind("delete-selected", "click", () => {
    if (!selectedFiles.size) return notice("Select files first.");
    modal(
      "Delete selected files",
      `<p>Permanently delete ${selectedFiles.size} selected files?</p>`,
      async () => {
        for (const id of selectedFiles)
          await api(base + "/files/" + id, "DELETE");
        selectedFiles.clear();
        await renderCollection();
      },
    );
  });
  document.querySelectorAll("[data-manage]").forEach(
    (el) =>
      (el.onclick = () => {
        const f = allFiles.find((x) => x.id === el.dataset.manage);
        modal(
          "Manage file",
          `<label>Name<input name="name" value="${escape(f.name)}" required></label>${fileDestination(folder)}<button id="delete-file" type="button" class="danger">Delete file</button>`,
          async (data) => {
            await api(base + "/files/" + f.id, "PATCH", {
              name: data.get("name"),
              folder: data.get("folder") || null,
            });
            await renderCollection();
          },
        );
        bind("delete-file", "click", () => {
          dialog.close();
          modal(
            "Delete file",
            `<p>Permanently delete ${escape(f.name)}?</p>`,
            async () => {
              await api(base + "/files/" + f.id, "DELETE");
              await renderCollection();
            },
          );
        });
      }),
  );
  bind("more-files", "click", () => {
    filesAfter = allFiles.at(-1).id;
    return files();
  });
}
function selectPermission(k, label, value) {
  return `<label>${label}<select name="${k}"><option value="inherit" ${value === null ? "selected" : ""}>Inherit collection / parent</option><option value="true" ${value === 1 ? "selected" : ""}>Allow</option><option value="false" ${value === 0 ? "selected" : ""}>Deny</option></select></label>`;
}
function editFolder(f) {
  modal(
    publicMode ? "Rename folder" : "Manage folder",
    `<label>Name<input name="name" value="${escape(f.name)}" required></label>${
      !publicMode
        ? `<label>Move to<select name="parent"><option value="">Collection root</option>${current.folders
            .filter((x) => x.id !== f.id)
            .map(
              (x) =>
                `<option value="${x.id}" ${f.parent === x.id ? "selected" : ""}>${escape(x.name)}</option>`,
            )
            .join(
              "",
            )}</select></label>${selectPermission("upload", "Upload files", f.upload)}${selectPermission("create_folder", "Create subfolders", f.create_folder)}${selectPermission("rename_own", "Rename recipient’s own folders", f.rename_own)}<label class="check"><input name="hidden" type="checkbox" ${f.hidden ? "checked" : ""}>Hide folder and descendants from recipients</label><button type="button" class="danger" id="delete-folder">Delete empty folder</button>`
        : ""
    }`,
    async (data) => {
      const b = { name: data.get("name") };
      if (!publicMode) {
        b.parent = data.get("parent") || null;
        b.hidden = data.has("hidden");
        for (const k of ["upload", "create_folder", "rename_own"])
          b[k] = data.get(k) === "inherit" ? null : data.get(k) === "true";
      }
      await api(base + "/folders/" + f.id, "PATCH", b);
      await refresh();
    },
  );
  bind("delete-folder", "click", async () => {
    await api(base + "/folders/" + f.id, "DELETE");
    dialog.close();
    folder = null;
    await refresh();
  });
}
function settingsForm() {
  document.querySelector("#settings").innerHTML =
    `<form class="panel form" id="settings-form"><label>Name<input name="name" value="${escape(current.name)}" required></label><label>Description<textarea name="description">${escape(current.description)}</textarea></label><label>New password<input name="password" type="password" autocomplete="new-password"><small>Leave blank to keep the current password.</small></label><label class="check"><input type="checkbox" name="clear_password">Remove collection password</label><label>Expiration<input name="expiry" type="datetime-local" value="${current.expires ? new Date(current.expires - new Date(current.expires).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}"></label><label>Storage limit (MB)<input name="quota" type="number" min="1" max="8000" value="${current.quota / 1e6}" required></label><label>Maximum file size (MB)<input name="max_file" type="number" min="1" max="2000" value="${current.max_file / 1e6}" required></label>${["upload", "create_folder", "rename_own"].map((k, i) => `<label class="check"><input type="checkbox" name="${k}" ${current[k] ? "checked" : ""}>${["Allow uploads", "Allow recipient folder creation", "Allow recipients to rename their own folders"][i]}</label>`).join("")}<button class="primary">Save settings</button><small>Your public URL stays the same.</small></form>`;
  bind("settings-form", "submit", async (e) => {
    e.preventDefault();
    const d = new FormData(e.target),
      b = {
        name: d.get("name"),
        description: d.get("description"),
        quota: Number(d.get("quota")) * 1e6,
        max_file: Number(d.get("max_file")) * 1e6,
        expires: d.get("expiry") ? new Date(d.get("expiry")).getTime() : null,
      };
    for (const k of ["upload", "create_folder", "rename_own"]) b[k] = d.has(k);
    if (d.get("password") || d.has("clear_password"))
      b.password = d.has("clear_password") ? "" : d.get("password");
    await api(base, "PATCH", b);
    notice("Settings saved");
    await refresh();
  });
}
async function manageFolderLinks() {
  const links=(await api(base+"/links")).filter(link=>link.folder===folder);
  modal("Directory upload links",links.map(link=>`<div class="row"><code>${escape(location.origin+"/s/"+link.token)}</code><button type="button" data-revoke-link="${link.token}" class="danger">Revoke</button></div>`).join("")||'<p class="muted">No links for this directory yet.</p>',async()=>{});
  document.querySelectorAll('[data-revoke-link]').forEach(el=>el.onclick=async()=>{try{await api(base+'/links/'+el.dataset.revokeLink,'DELETE');dialog.close();await manageFolderLinks()}catch(error){notice(error.message)}});
}
function share(token) {
  const url =
    location.origin +
    "/s/" +
    (typeof token === "string" ? token : current.token);
  modal(
    typeof token === "string" ? "Share directory" : "Share collection",
    `<p>Recipients see the folders you prepared and can upload where permitted.</p><div class="linkbox">${escape(url)}</div><button type="button" id="copy">Copy link</button>`,
    async () => {},
  );
  bind("copy", "click", async () => {
    await navigator.clipboard.writeText(url);
    notice("Link copied");
  });
}
async function upload(e) {
  const uploadBase = base,
    uploadFolder = folder;
  const selected = [...e.target.files];
  busy = true;
  e.target.disabled = true;
  const progress = document.querySelector("#progress"),
    status = document.querySelector("#upload-status");
  progress.hidden = false;
  try {
    for (const file of selected) {
      if (file.size > current.max_file)
        throw new Error(file.name + " exceeds the file size limit.");
      const init = await api(uploadBase + "/uploads", "POST", {
        folder: uploadFolder,
        name: file.name,
        size: file.size,
      });
      const parts = [];
      for (let n = 1; n <= init.parts; n++) {
        status.textContent = `Uploading ${file.name} — part ${n} of ${init.parts}`;
        const auth = await api(
          uploadBase + "/uploads/" + init.id + "/part",
          "POST",
          {
            part: n,
          },
        );
        const response = await fetch(auth.url, {
          method: "PUT",
          body: file.slice((n - 1) * init.part_size, n * init.part_size),
        });
        if (!response.ok) throw new Error("Upload failed. Please try again.");
        const uploaded = await response.json();
        parts.push(uploaded);
        progress.value = (n / init.parts) * 100;
      }
      await api(uploadBase + "/uploads/" + init.id + "/complete", "POST", {
        parts,
      });
    }
    notice("Files received");
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    await renderCollection();
  }
}
async function keys() {
  const list = await api("keys");
  shell(
    `<header class="top"><div><h1>API keys</h1><span class="muted">Automate collections, folders, and uploads.</span></div><button class="primary" id="new-key">Create key</button></header><div class="panel"><p>Use <code>Authorization: Bearer fv_…</code> with <code>/api/collections</code>. Keys grant full administrator access. Keep them on your server.</p>${list.map((k) => `<div class="row"><strong>${escape(k.name)}</strong><button class="danger" data-revoke="${k.id}">Revoke</button></div>`).join("") || '<p class="muted">No API keys yet.</p>'}</div>`,
    "api",
  );
  bind("new-key", "click", () =>
    modal(
      "Create API key",
      '<label>Name<input name="name" required></label>',
      async (data) => {
        const key = await api("keys", "POST", { name: data.get("name") });
        await keys();
        setTimeout(() => {
          modal(
            "Save your API key",
            `<p>This key is shown only once.</p><div class="linkbox">${escape(key.key)}</div>`,
            async () => {},
          );
        }, 0);
      },
    ),
  );
  document.querySelectorAll("[data-revoke]").forEach(
    (el) =>
      (el.onclick = () =>
        modal(
          "Revoke API key",
          "<p>Applications using this key will lose access.</p>",
          async () => {
            await api("keys/" + el.dataset.revoke, "DELETE");
            await keys();
          },
        )),
  );
}
async function publicStart() {
  const token = location.pathname.split("/")[2];
  base = "share/" + token;
  try {
    await api(base + "/open", "POST", {});
    await openCollection(token);
  } catch (error) {
    app.innerHTML = `<main class="login">${logo}<h1>Open collection</h1><p class="muted">${escape(error.message)}</p><form id="unlock"><label>Collection password<input name="password" type="password" required></label><button class="primary">Continue</button></form></main>`;
    bind("unlock", "submit", async (e) => {
      e.preventDefault();
      await api(base + "/open", "POST", {
        password: new FormData(e.target).get("password"),
      });
      await openCollection(token);
    });
  }
}
if (localStorage.getItem("theme") === "dark")
  document.body.classList.add("dark");
(publicMode ? publicStart() : login()).catch((e) => {
  app.textContent = e.message;
});
