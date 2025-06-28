function renderCollection(collectionData) {
    const li = document.createElement('li');
    li.className = 'collection-item';
    li.dataset.id = collectionData.id;

    const a = document.createElement('a');
    // --- FIX: Add title attribute for hover tooltip ---
    a.title = collectionData.name; 
    a.innerHTML = `<i data-feather="folder"></i><span>${collectionData.name}</span>`;
    a.onclick = () => {
        loadCollectionItems(collectionData.id, collectionData.name);
    };
    li.appendChild(a);
    collectionsListEl.appendChild(li);
    feather.replace();
}

function renderItem(itemData) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'library-item';
    itemDiv.dataset.id = itemData.id;

    const iconType = itemData.type === 'transcript' ? 'file-text' : 'layers';
    const badgeClass = itemData.type === 'transcript' ? 'transcript-badge' : 'flashcard-badge';
    const badgeText = itemData.type === 'transcript' ? 'Transcript' : 'Flashcard Deck';

    itemDiv.innerHTML = `
        <div class="item-main">
            <i data-feather="${iconType}" class="item-icon"></i>
            <div class="item-details">
                <p class="item-title" title="${itemData.title}">${itemData.title}</p> 
                <span class="item-badge ${badgeClass}">${badgeText}</span>
            </div>
        </div>
        <div class="item-actions">
            <button class="btn-icon btn-delete-item" title="Delete"><i data-feather="x"></i></button>
        </div>
    `;

    itemDiv.querySelector('.btn-delete-item').onclick = (e) => {
        e.stopPropagation();
        deleteItem(itemData.id, itemData.type);
    };

    itemsListEl.appendChild(itemDiv);
    feather.replace();
}
