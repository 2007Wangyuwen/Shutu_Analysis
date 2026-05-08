import crypto from 'node:crypto';
/** 分享快照默认 24 小时有效 */
export const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const store = new Map();
function pruneExpired() {
    const now = Date.now();
    for (const [id, v] of store) {
        if (v.expiresAt <= now)
            store.delete(id);
    }
}
export function saveShare(payload) {
    pruneExpired();
    const id = crypto.randomBytes(12).toString('hex');
    store.set(id, { payload, expiresAt: Date.now() + SHARE_TTL_MS });
    return id;
}
export function getShare(id) {
    pruneExpired();
    const v = store.get(id);
    if (!v)
        return null;
    if (v.expiresAt <= Date.now()) {
        store.delete(id);
        return null;
    }
    return v.payload;
}
