const DB_NAME = 'AutomationManagerDB';
const DB_VERSION = 1;

let dbInstance = null;

function initDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('Database error:', event.target.error);
            reject(event.target.error);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Clients
            if (!db.objectStoreNames.contains('clients')) {
                const store = db.createObjectStore('clients', { keyPath: 'id' });
                store.createIndex('name', 'name', { unique: false });
            }

            // Services
            if (!db.objectStoreNames.contains('services')) {
                db.createObjectStore('services', { keyPath: 'id' });
            }

            // Quotes
            if (!db.objectStoreNames.contains('quotes')) {
                const store = db.createObjectStore('quotes', { keyPath: 'id' });
                store.createIndex('clientId', 'clientId', { unique: false });
                store.createIndex('date', 'date', { unique: false });
            }

            // Projects
            if (!db.objectStoreNames.contains('projects')) {
                const store = db.createObjectStore('projects', { keyPath: 'id' });
                store.createIndex('clientId', 'clientId', { unique: false });
                store.createIndex('status', 'status', { unique: false });
            }

            // Tasks
            if (!db.objectStoreNames.contains('tasks')) {
                const store = db.createObjectStore('tasks', { keyPath: 'id' });
                store.createIndex('projectId', 'projectId', { unique: false });
                store.createIndex('clientId', 'clientId', { unique: false });
                store.createIndex('dueDate', 'dueDate', { unique: false });
            }

            // Invoices
            if (!db.objectStoreNames.contains('invoices')) {
                const store = db.createObjectStore('invoices', { keyPath: 'id' });
                store.createIndex('clientId', 'clientId', { unique: false });
                store.createIndex('projectId', 'projectId', { unique: false });
            }

            // Payments
            if (!db.objectStoreNames.contains('payments')) {
                const store = db.createObjectStore('payments', { keyPath: 'id' });
                store.createIndex('invoiceId', 'invoiceId', { unique: false });
            }

            // Expenses
            if (!db.objectStoreNames.contains('expenses')) {
                const store = db.createObjectStore('expenses', { keyPath: 'id' });
                store.createIndex('projectId', 'projectId', { unique: false });
                store.createIndex('clientId', 'clientId', { unique: false });
                store.createIndex('date', 'date', { unique: false });
            }

            // Team
            if (!db.objectStoreNames.contains('team')) {
                db.createObjectStore('team', { keyPath: 'id' });
            }

            // Notes
            if (!db.objectStoreNames.contains('notes')) {
                const store = db.createObjectStore('notes', { keyPath: 'id' });
                store.createIndex('relatedId', 'relatedId', { unique: false }); // ID of client/project
            }

            // Activity
            if (!db.objectStoreNames.contains('activity')) {
                const store = db.createObjectStore('activity', { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: false });
            }

            // Settings - Use a simple key-value store approach
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'id' }); // id will just be 'appSettings'
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };
    });
}

const db = {
    async get(storeName, id) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAll(storeName) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async put(storeName, data) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async delete(storeName, id) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getByIndex(storeName, indexName, value) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async clear(storeName) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};

window.appDB = db;