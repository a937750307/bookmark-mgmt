/* ========================================
   收藏夹管理器 - 核心逻辑 (v2)
   功能: 编辑器 / 去重 / 拖拽排序 / 暗色模式
        Markdown导出 / 合并 / 快捷键
   ======================================== */

// ---- State ----
let bookmarkData = null;
let selectedIds = new Set();
let exportFormat = 'html';
let exportMode = 'selected'; // 'selected' | 'unselected'
let idCounter = 0;
let duplicateUrlMap = {};  // url => [ids]
let viewPath = [];  // breadcrumb path: [{id, title}, ...]

// ---- DOM Elements ----
const $ = function (id) { return document.getElementById(id); };

const uploadArea = $('uploadArea');
const fileInput = $('fileInput');
const bookmarkContainer = $('bookmarkContainer');
const emptyState = $('emptyState');
const bookmarkTree = $('bookmarkTree');
const searchInput = $('searchInput');
const selectedCountEl = $('selectedCount');
const totalCountEl = $('totalCount');
const exportModal = $('exportModal');
const toast = $('toast');
const mergeInput = $('mergeInput');
const breadcrumbBar = $('breadcrumbBar');

// ---- Dark Mode ----
const STORAGE_THEME_KEY = 'bm_theme';

function initTheme() {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    if (saved === 'dark') {
        document.body.classList.add('dark');
    } else if (saved === 'light') {
        document.body.classList.remove('dark');
    } else {
        // follow system preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark');
        }
    }
    // listen for system preference changes (only if user hasn't set explicitly)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        const saved = localStorage.getItem(STORAGE_THEME_KEY);
        if (!saved) {
            document.body.classList.toggle('dark', e.matches);
        }
    });
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem(STORAGE_THEME_KEY, isDark ? 'dark' : 'light');
}

// ---- Upload & Parse ----
uploadArea.addEventListener('click', function () { fileInput.click(); });

uploadArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', function () {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', function (e) {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

function handleFile(file, merge) {
    if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
        showToast('请上传 HTML 格式的收藏夹文件', 'error');
        return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var newData = parseBookmarkHTML(e.target.result);
            if (merge && bookmarkData) {
                bookmarkData = mergeBookmarkTrees(bookmarkData, newData);
                showToast('收藏夹合并成功', 'success');
            } else {
                bookmarkData = newData;
                selectedIds.clear();
                viewPath = [];
                showToast('收藏夹加载成功', 'success');
            }
            refreshAll();
        } catch (err) {
            showToast('解析文件失败，请检查文件格式', 'error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function parseBookmarkHTML(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var dl = doc.querySelector('dl');
    if (!dl) throw new Error('无法识别的收藏夹格式');

    idCounter = 0;
    return parseBookmarkNode(dl);
}

function parseBookmarkNode(element) {
    var items = [];
    var children = element.children;
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.tagName !== 'DT') continue;

        var h3 = child.querySelector('h3');
        var a = child.querySelector('a');
        var dl = child.querySelector('dl');
        var id = 'node_' + (idCounter++);

        if (h3) {
            items.push({
                id: id,
                type: 'folder',
                title: h3.textContent.trim(),
                addDate: h3.getAttribute('add_date'),
                lastModified: h3.getAttribute('last_modified'),
                children: dl ? parseBookmarkNode(dl) : [],
                expanded: false
            });
        } else if (a) {
            var url = a.getAttribute('href') || '';
            items.push({
                id: id,
                type: 'link',
                title: a.textContent.trim(),
                url: url,
                addDate: a.getAttribute('add_date'),
                icon: a.getAttribute('icon'),
                isCode: url.startsWith('javascript:')
            });
        }
    }
    return items;
}

// ---- Merge ----
function mergeBookmarkTrees(existing, incoming) {
    // simple merge: append incoming at root level, deduplicate later if needed
    return existing.concat(incoming);
}

// ---- Breadcrumb helpers ----
function getViewNodes() {
    if (viewPath.length === 0) return bookmarkData;
    var node = findNodeById(bookmarkData, viewPath[viewPath.length - 1].id);
    return node && node.children ? node.children : [];
}

function renderBreadcrumbs() {
    var html = '<span class="breadcrumb-item' + (viewPath.length === 0 ? ' current' : '') + '" data-idx="-1">首页</span>';
    for (var i = 0; i < viewPath.length; i++) {
        html += '<span class="breadcrumb-sep">/</span>';
        html += '<span class="breadcrumb-item' + (i === viewPath.length - 1 ? ' current' : '') + '" data-idx="' + i + '">' + escapeHtml(viewPath[i].title) + '</span>';
    }
    breadcrumbBar.innerHTML = html;
    breadcrumbBar.style.display = 'flex';

    // attach click handlers
    breadcrumbBar.querySelectorAll('.breadcrumb-item').forEach(function (el) {
        el.addEventListener('click', function () {
            var idx = parseInt(this.dataset.idx);
            navigateBreadcrumb(idx);
        });
    });
}

function navigateBreadcrumb(idx) {
    if (idx === -1) {
        viewPath = [];
    } else {
        viewPath = viewPath.slice(0, idx + 1);
    }
    renderBreadcrumbs();
    renderTree();
}

function enterFolder(id) {
    var node = findNodeById(bookmarkData, id);
    if (!node || node.type !== 'folder') return;
    viewPath.push({ id: node.id, title: node.title });
    renderBreadcrumbs();
    renderTree();
}

// ---- Render ----
function refreshAll() {
    renderBreadcrumbs();
    renderTree();
    updateUI();
    updateSelectedCount();
    detectDuplicates();

}

function renderTree() {
    if (!bookmarkData) return;
    var searchTerm = searchInput.value.toLowerCase().trim();
    var nodes = getViewNodes();
    bookmarkTree.innerHTML = renderNodes(nodes, searchTerm);
    attachTreeEvents();
    attachDragEvents();
}

function renderNodes(nodes, searchTerm) {
    if (!nodes || nodes.length === 0) return '';

    var html = '';
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var isMatch = searchTerm && matchesSearch(node, searchTerm);
        var shouldShow = !searchTerm || isMatch || hasMatchingChild(node, searchTerm);
        if (!shouldShow) continue;

        var isSelected = selectedIds.has(node.id);
        var isFolder = node.type === 'folder';
        var hasChildren = isFolder && node.children && node.children.length > 0;
        var isExpanded = isFolder && node.expanded;
        var checkboxState = getCheckboxState(node);
        var isDup = !isFolder && duplicateUrlMap[node.url] && duplicateUrlMap[node.url].length > 1;

        html += '<div class="tree-item" data-id="' + node.id + '" data-type="' + node.type + '" draggable="true">';
        html += '<div class="tree-row' + (isSelected ? ' selected' : '') + '" data-id="' + node.id + '">';
        html += '<div class="checkbox ' + checkboxState + '" data-id="' + node.id + '"></div>';

        // icon
        html += '<div class="item-icon">';
        if (isFolder) {
            html += '<svg class="folder-icon-svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
        } else if (node.isCode) {
            html += '<svg class="code-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
        } else {
            html += '<svg class="link-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        }
        html += '</div>';

        // title (editable span)
        html += '<span class="item-title" data-field="title" data-id="' + node.id + '">' + escapeHtml(node.title) + '</span>';

        // folder indicator
        if (isFolder) {
            var childCount = node.children ? node.children.length : 0;
            html += '<span class="folder-indicator">' + childCount + ' 项</span>';
        }

        // type tags
        if (!isFolder && node.isCode) {
            html += '<span class="item-type-tag tag-code">JS</span>';
        }
        if (isDup) {
            html += '<span class="dup-badge" title="检测到重复链接">重复</span>';
        }

        // url
        if (!isFolder) {
            html += '<span class="item-url" data-field="url" data-id="' + node.id + '">' + escapeHtml(node.url || '') + '</span>';
        }

        // action buttons
        html += '<div class="tree-actions">';
        html += '<button class="tree-action-btn" data-action="edit" data-id="' + node.id + '" title="编辑">';
        html += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
        html += '</button>';
        html += '<button class="tree-action-btn delete" data-action="delete" data-id="' + node.id + '" title="删除">';
        html += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        html += '</button>';
        html += '</div>';

        html += '</div>'; // tree-row

        html += '</div>'; // tree-item
    }
    return html;
}

// ---- Search helpers ----
function matchesSearch(node, term) {
    var title = (node.title || '').toLowerCase();
    var url = (node.url || '').toLowerCase();
    return title.indexOf(term) !== -1 || url.indexOf(term) !== -1;
}

function hasMatchingChild(node, term) {
    if (node.type !== 'folder' || !node.children) return false;
    return node.children.some(function (c) {
        return matchesSearch(c, term) || hasMatchingChild(c, term);
    });
}

// ---- Tree operations ----
function findNodeById(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.id === id) return node;
        if (node.children) {
            var found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function findParentNode(nodes, id, parent) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.id === id) return parent || null;
        if (node.children) {
            var found = findParentNode(node.children, id, node);
            if (found) return found;
        }
    }
    return null;
}

function getAllChildIds(node) {
    var ids = [];
    if (node.type === 'folder' && node.children) {
        for (var i = 0; i < node.children.length; i++) {
            ids.push(node.children[i].id);
            ids = ids.concat(getAllChildIds(node.children[i]));
        }
    }
    return ids;
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---- Event handling for tree ----
function attachTreeEvents() {
    // checkbox
    document.querySelectorAll('.checkbox').forEach(function (cb) {
        cb.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleSelection(this.dataset.id);
        });
    });

    // tree row click
    document.querySelectorAll('.tree-row').forEach(function (row) {
        row.addEventListener('click', function (e) {
            if (e.target.closest('.checkbox') ||
                e.target.closest('.tree-actions') || e.target.closest('.tree-action-btn') ||
                e.target.closest('.inline-edit-input')) return;
            var node = findNodeById(bookmarkData, this.dataset.id);
            if (node && node.type === 'folder') {
                enterFolder(this.dataset.id);
            } else {
                toggleSelection(this.dataset.id);
            }
        });
    });

    // edit button
    document.querySelectorAll('.tree-action-btn[data-action="edit"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            startInlineEdit(this.dataset.id);
        });
    });

    // delete button
    document.querySelectorAll('.tree-action-btn[data-action="delete"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            deleteNode(this.dataset.id);
        });
    });

    // add child button
    document.querySelectorAll('.tree-add-btn[data-action="addChild"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            addChildToFolder(this.dataset.id);
        });
    });
}

// ---- Selection ----
function toggleSelection(id) {
    var node = findNodeById(bookmarkData, id);
    if (!node) return;

    if (selectedIds.has(id)) {
        selectedIds.delete(id);
        if (node.children) {
            var childIds = getAllChildIds(node);
            childIds.forEach(function (cid) { selectedIds.delete(cid); });
        }
    } else {
        selectedIds.add(id);
        if (node.children) {
            var childIds = getAllChildIds(node);
            childIds.forEach(function (cid) { selectedIds.add(cid); });
        }
    }

    updateParentSelection(bookmarkData);
    renderTree();
    updateSelectedCount();

}

function updateParentSelection(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.type === 'folder' && node.children) {
            updateParentSelection(node.children);
            var childIds = getAllChildIds(node);
            var allSelected = childIds.length > 0 && childIds.every(function (id) { return selectedIds.has(id); });
            var someSelected = childIds.some(function (id) { return selectedIds.has(id); });

            if (allSelected) {
                selectedIds.add(node.id);
            } else if (!someSelected) {
                selectedIds.delete(node.id);
            }
        }
    }
}

function getCheckboxState(node) {
    if (selectedIds.has(node.id)) return 'checked';
    if (node.type === 'folder' && node.children) {
        var childIds = getAllChildIds(node);
        var count = childIds.filter(function (id) { return selectedIds.has(id); }).length;
        if (count === 0) return '';
        if (count === childIds.length) return 'checked';
        return 'partial';
    }
    return '';
}

function updateSelectedCount() {
    var count = 0;
    selectedIds.forEach(function (id) {
        var node = findNodeById(bookmarkData, id);
        if (node && node.type === 'link') count++;
    });
    if (selectedCountEl) selectedCountEl.textContent = count;
}

function updateUI() {
    if (bookmarkData && bookmarkData.length > 0) {
        bookmarkContainer.style.display = 'block';
        emptyState.style.display = 'none';
    } else {
        bookmarkContainer.style.display = 'none';
        emptyState.style.display = 'block';
    }
}

// ---- Toolbar: select / deselect ----
document.getElementById('selectAllBtn').addEventListener('click', function () {
    var nodes = getViewNodes();
    for (var i = 0; i < nodes.length; i++) {
        selectedIds.add(nodes[i].id);
    }
    renderTree();
    updateSelectedCount();
});

document.getElementById('deselectAllBtn').addEventListener('click', function () {
    selectedIds.clear();
    renderTree();
    updateSelectedCount();

});

function selectAll(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        selectedIds.add(nodes[i].id);
        if (nodes[i].children) selectAll(nodes[i].children);
    }
}


function collapseAll(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].type === 'folder') {
            nodes[i].expanded = false;
            if (nodes[i].children) collapseAll(nodes[i].children);
        }
    }
}

function selectAll(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        selectedIds.add(nodes[i].id);
        if (nodes[i].children) selectAll(nodes[i].children);
    }
}

function toggleFolder(id) {
    var node = findNodeById(bookmarkData, id);
    if (node && node.type === 'folder') {
        node.expanded = !node.expanded;
        renderTree();
    
    }
}

searchInput.addEventListener('input', function () {
    renderTree();
});

// ---- Editor: Add / Edit / Delete ----
function startInlineEdit(id) {
    var node = findNodeById(bookmarkData, id);
    if (!node) return;

    var titleEl = document.querySelector('.item-title[data-id="' + id + '"]');
    var urlEl = document.querySelector('.item-url[data-id="' + id + '"]');

    if (!titleEl) return;

    // save original values
    var originalTitle = node.title;
    var originalUrl = node.url;

    // replace title with input
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'inline-edit-input';
    titleInput.value = node.title;
    titleInput.dataset.original = originalTitle;
    titleInput.dataset.field = 'title';
    titleInput.dataset.id = id;
    titleEl.replaceWith(titleInput);
    titleInput.focus();
    titleInput.select();

    // for links, also edit URL
    var urlInput = null;
    if (node.type === 'link' && urlEl) {
        urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.className = 'inline-edit-input url-input';
        urlInput.value = node.url || '';
        urlInput.dataset.original = originalUrl || '';
        urlInput.dataset.field = 'url';
        urlInput.dataset.id = id;
        urlEl.replaceWith(urlInput);
    }

    function finishEdit(save) {
        if (save) {
            node.title = (titleInput && titleInput.parentNode) ? titleInput.value.trim() || originalTitle : originalTitle;
            if (urlInput && urlInput.parentNode) {
                node.url = urlInput.value.trim();
                node.isCode = node.url.startsWith('javascript:');
            }
            refreshAll();
        } else {
            refreshAll();
        }
    }

    function onKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEdit(false);
        }
    }

    titleInput.addEventListener('keydown', onKeydown);
    titleInput.addEventListener('blur', function () { finishEdit(true); });

    if (urlInput) {
        urlInput.addEventListener('keydown', onKeydown);
        urlInput.addEventListener('blur', function () { finishEdit(true); });
    }
}

function deleteNode(id) {
    if (!confirm('确认删除 "' + (findNodeById(bookmarkData, id) || {}).title + '" 及其所有子项？')) return;

    var deleted = removeNodeById(bookmarkData, id);
    if (deleted) {
        // also remove from selectedIds
        selectedIds.delete(id);
        if (deleted.type === 'folder') {
            getAllChildIds(deleted).forEach(function (cid) { selectedIds.delete(cid); });
        }
        refreshAll();
        showToast('已删除', 'success');
    }
}

function removeNodeById(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
            return nodes.splice(i, 1)[0];
        }
        if (nodes[i].children) {
            var result = removeNodeById(nodes[i].children, id);
            if (result) return result;
        }
    }
    return null;
}

function currentViewArray() {
    if (viewPath.length === 0) return bookmarkData;
    var parent = findNodeById(bookmarkData, viewPath[viewPath.length - 1].id);
    if (parent && parent.type === 'folder') {
        if (!parent.children) parent.children = [];
        return parent.children;
    }
    return bookmarkData;
}

function addRootBookmark() {
    if (!bookmarkData) bookmarkData = [];
    var newId = 'node_' + (idCounter++);
    currentViewArray().push({
        id: newId,
        type: 'link',
        title: '新书签',
        url: 'https://',
        addDate: Math.floor(Date.now() / 1000).toString(),
        isCode: false
    });
    refreshAll();
    showToast('新书签已创建', 'success');
}

function addRootFolder() {
    if (!bookmarkData) bookmarkData = [];
    var newId = 'node_' + (idCounter++);
    currentViewArray().push({
        id: newId,
        type: 'folder',
        title: '新文件夹',
        children: [],
        expanded: true
    });
    refreshAll();
    showToast('新文件夹已创建', 'success');
}

// ---- Duplicate Detection ----
function detectDuplicates() {
    duplicateUrlMap = {};
    var urlToIds = {};

    function collectUrls(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.type === 'link' && node.url && !node.url.startsWith('javascript:')) {
                if (!urlToIds[node.url]) urlToIds[node.url] = [];
                urlToIds[node.url].push(node.id);
            }
            if (node.children) collectUrls(node.children);
        }
    }
    collectUrls(bookmarkData);

    // only keep urls with duplicates
    for (var url in urlToIds) {
        if (urlToIds[url].length > 1) {
            duplicateUrlMap[url] = urlToIds[url];
        }
    }
}

function removeDuplicates() {
    var dupCount = Object.keys(duplicateUrlMap).length;
    if (dupCount === 0) {
        showToast('没有检测到重复链接', 'success');
        return;
    }

    if (!confirm('检测到 ' + dupCount + ' 组重复链接。将保留每组中的第一个，删除其余。确认执行？')) return;

    var removed = 0;
    for (var url in duplicateUrlMap) {
        var ids = duplicateUrlMap[url];
        // keep first, remove rest
        for (var i = 1; i < ids.length; i++) {
            var removedNode = removeNodeById(bookmarkData, ids[i]);
            if (removedNode) {
                selectedIds.delete(ids[i]);
                removed++;
            }
        }
    }

    duplicateUrlMap = {};
    refreshAll();
    showToast('已清理 ' + removed + ' 个重复链接', 'success');
}

// ---- Drag and Drop ----
var dragNodeId = null;
var dragSourceParent = null;

function attachDragEvents() {
    var items = document.querySelectorAll('.tree-item');

    items.forEach(function (item) {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
    });
}

function handleDragStart(e) {
    dragNodeId = this.dataset.id;
    dragSourceParent = findParentNode(bookmarkData, dragNodeId);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragNodeId);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    e.preventDefault();
    var targetId = this.dataset.id;
    if (targetId === dragNodeId) return;

    var targetNode = findNodeById(bookmarkData, targetId);
    if (targetNode && targetNode.type === 'folder') {
        this.classList.add('drag-over-inside');
    } else {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    // only remove class if really leaving this tree-item (not just moving to a child)
    if (!this.contains(e.relatedTarget)) {
        this.classList.remove('drag-over', 'drag-over-inside');
    }
}

function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();

    var targetId = this.dataset.id;
    var isInsideFolder = this.classList.contains('drag-over-inside');

    this.classList.remove('drag-over', 'drag-over-inside');

    if (!dragNodeId || targetId === dragNodeId) return;

    // find and remove dragged node before locating target
    var draggedNode = removeNodeById(bookmarkData, dragNodeId);
    if (!draggedNode) return;

    var targetNode = findNodeById(bookmarkData, targetId);
    if (!targetNode) return;

    // if dropping inside a folder
    if (targetNode.type === 'folder' && isInsideFolder) {
        if (!targetNode.children) targetNode.children = [];
        targetNode.children.push(draggedNode);
    } else {
        // place before target in its parent array
        var parentArray = findParentArray(bookmarkData, targetId);
        if (parentArray) {
            var targetIndex = -1;
            for (var i = 0; i < parentArray.length; i++) {
                if (parentArray[i].id === targetId) { targetIndex = i; break; }
            }
            if (targetIndex !== -1) {
                parentArray.splice(targetIndex, 0, draggedNode);
            } else {
                parentArray.push(draggedNode);
            }
        } else {
            // target is at root level
            var rootIndex = -1;
            for (var j = 0; j < bookmarkData.length; j++) {
                if (bookmarkData[j].id === targetId) { rootIndex = j; break; }
            }
            if (rootIndex !== -1) {
                bookmarkData.splice(rootIndex, 0, draggedNode);
            } else {
                bookmarkData.push(draggedNode);
            }
        }
    }

    refreshAll();
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.tree-item').forEach(function (it) {
        it.classList.remove('drag-over', 'drag-over-inside');
    });
    dragNodeId = null;
}

function findParentArray(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].children) {
            for (var j = 0; j < nodes[i].children.length; j++) {
                if (nodes[i].children[j].id === id) return nodes[i].children;
            }
            var result = findParentArray(nodes[i].children, id);
            if (result) return result;
        }
    }
    return null;
}

// ---- Export ----
document.getElementById('exportBtn').addEventListener('click', function () {
    var count = countSelectedLinks();
    var unselectedCount = countUnselectedLinks();

    if (exportMode === 'selected' && count === 0) {
        showToast('请先选择要导出的项目', 'error');
        return;
    }
    if (exportMode === 'unselected' && unselectedCount === 0) {
        showToast('没有未选中的链接可导出', 'error');
        return;
    }

    var displayCount = exportMode === 'selected' ? count : unselectedCount;
    document.getElementById('modalSelectedCount').textContent = displayCount;

    // update range toggle
    document.querySelectorAll('.range-option').forEach(function (opt) {
        opt.classList.toggle('active', opt.dataset.mode === exportMode);
    });

    exportModal.classList.add('active');
});

document.getElementById('cancelExport').addEventListener('click', function () {
    exportModal.classList.remove('active');
});

exportModal.addEventListener('click', function (e) {
    if (e.target === exportModal) exportModal.classList.remove('active');
});

// export format selection
document.querySelectorAll('.export-option').forEach(function (option) {
    option.addEventListener('click', function () {
        document.querySelectorAll('.export-option').forEach(function (o) { o.classList.remove('selected'); });
        this.classList.add('selected');
        exportFormat = this.dataset.format;
    });
});

// export range selection
document.querySelectorAll('.range-option').forEach(function (opt) {
    opt.addEventListener('click', function () {
        exportMode = this.dataset.mode;
        document.querySelectorAll('.range-option').forEach(function (o) { o.classList.remove('active'); });
        this.classList.add('active');

        var count = exportMode === 'selected' ? countSelectedLinks() : countUnselectedLinks();
        document.getElementById('modalSelectedCount').textContent = count;
    });
});

document.getElementById('confirmExport').addEventListener('click', function () {
    performExport();
    exportModal.classList.remove('active');
});

function countSelectedLinks() {
    var count = 0;
    selectedIds.forEach(function (id) {
        var node = findNodeById(bookmarkData, id);
        if (node && node.type === 'link') count++;
    });
    return count;
}

function countUnselectedLinks() {
    var count = 0;
    function traverse(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].type === 'link' && !selectedIds.has(nodes[i].id)) count++;
            if (nodes[i].children) traverse(nodes[i].children);
        }
    }
    traverse(bookmarkData);
    return count;
}

function performExport() {
    var nodesToExport = [];

    function collect(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (exportMode === 'selected') {
                if (selectedIds.has(node.id)) {
                    nodesToExport.push(node);
                } else if (node.children) {
                    collect(node.children);
                }
            } else {
                // unselected mode
                if (node.type === 'link' && !selectedIds.has(node.id)) {
                    nodesToExport.push(node);
                } else if (node.type === 'folder') {
                    // for folders in unselected mode, include if has any unselected children
                    var hasUnselected = false;
                    if (node.children) {
                        var childIds = getAllChildIds(node);
                        hasUnselected = childIds.some(function (cid) {
                            var n = findNodeById(bookmarkData, cid);
                            return n && n.type === 'link' && !selectedIds.has(cid);
                        });
                    }
                    if (hasUnselected) {
                        nodesToExport.push(node);
                    } else if (node.children) {
                        collect(node.children);
                    }
                }
            }
        }
    }
    collect(bookmarkData);

    var content = '';
    var filename = '';
    var mimeType = '';

    if (exportFormat === 'html') {
        content = generateHTML(nodesToExport);
        filename = 'bookmarks_' + today() + '.html';
        mimeType = 'text/html;charset=utf-8';
    } else if (exportFormat === 'json') {
        content = JSON.stringify(nodesToExport, null, 2);
        filename = 'bookmarks_' + today() + '.json';
        mimeType = 'application/json;charset=utf-8';
    } else if (exportFormat === 'txt') {
        content = generateTXT(nodesToExport);
        filename = 'bookmarks_' + today() + '.txt';
        mimeType = 'text/plain;charset=utf-8';
    } else if (exportFormat === 'md') {
        content = generateMarkdown(nodesToExport);
        filename = 'bookmarks_' + today() + '.md';
        mimeType = 'text/markdown;charset=utf-8';
    }

    downloadFile(content, filename, mimeType);
    showToast('导出成功: ' + filename, 'success');
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function generateHTML(nodes) {
    var html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n'
        + '<!-- This is an automatically generated file.\n'
        + '     It will be read and overwritten.\n'
        + '     DO NOT EDIT! -->\n'
        + '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n'
        + '<TITLE>Bookmarks</TITLE>\n'
        + '<H1>Bookmarks</H1>\n'
        + '<DL><p>\n';

    function gen(nodes, indent) {
        var result = '';
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.type === 'folder') {
                result += indent + '<DT><H3 ADD_DATE="' + (node.addDate || '') + '" LAST_MODIFIED="' + (node.lastModified || '') + '">' + escapeHtml(node.title) + '</H3>\n';
                result += indent + '<DL><p>\n';
                if (node.children) result += gen(node.children, indent + '    ');
                result += indent + '</DL><p>\n';
            } else {
                result += indent + '<DT><A HREF="' + escapeHtml(node.url) + '" ADD_DATE="' + (node.addDate || '') + '">' + escapeHtml(node.title) + '</A>\n';
            }
        }
        return result;
    }

    html += gen(nodes, '    ');
    html += '</DL><p>';
    return html;
}

function generateTXT(nodes) {
    var result = '';

    function traverse(nodes, depth) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var prefix = '  '.repeat(depth);
            if (node.type === 'folder') {
                result += prefix + '[文件夹] ' + node.title + '\n';
                if (node.children) traverse(node.children, depth + 1);
            } else {
                result += prefix + node.title + '\n' + prefix + '  ' + node.url + '\n';
            }
        }
    }

    traverse(nodes, 0);
    return result;
}

function generateMarkdown(nodes) {
    var result = '# Bookmarks\n\n';

    function traverse(nodes, depth) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.type === 'folder') {
                var prefix = '#'.repeat(Math.min(depth + 2, 6));
                result += prefix + ' ' + node.title + '\n\n';
                if (node.children) traverse(node.children, depth + 1);
            } else {
                var indent = '  '.repeat(depth);
                result += indent + '- [' + node.title.replace(/[[\]]/g, '\\$&') + '](' + node.url + ')\n';
            }
        }
    }

    traverse(nodes, 0);
    return result;
}

// ---- Merge ----
if (mergeInput) {
    document.getElementById('mergeBtn').addEventListener('click', function () {
        mergeInput.click();
    });

    mergeInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0], true);
            mergeInput.value = '';
        }
    });
}

// ---- Dark mode button ----
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// ---- Add buttons ----
document.getElementById('addBookmarkBtn').addEventListener('click', addRootBookmark);
document.getElementById('addFolderBtn').addEventListener('click', addRootFolder);

// ---- Deduplicate button ----
document.getElementById('dedupBtn').addEventListener('click', removeDuplicates);

// ---- Delete selected button ----
document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelected);

function deleteSelected() {
    var idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) {
        showToast('请先选择要删除的项目', 'error');
        return;
    }
    if (!confirm('确认删除 ' + idsToDelete.length + ' 个选中项目？')) return;
    for (var i = 0; i < idsToDelete.length; i++) {
        removeNodeById(bookmarkData, idsToDelete[i]);
    }
    selectedIds.clear();
    refreshAll();
    showToast('已删除', 'success');
}

// ---- Utilities ----
function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showToast(message, type) {
    type = type || 'success';
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(function () {
        toast.classList.remove('show');
    }, 3000);
}

// ---- Init ----
initTheme();

// empty state buttons
var addBookmarkEmpty = document.getElementById('addBookmarkEmpty');
var addFolderEmpty = document.getElementById('addFolderEmpty');
if (addBookmarkEmpty) addBookmarkEmpty.addEventListener('click', addRootBookmark);
if (addFolderEmpty) addFolderEmpty.addEventListener('click', addRootFolder);

updateUI();
