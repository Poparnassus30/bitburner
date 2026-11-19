/** @param {NS} ns */

export function parseVersion(content) {
    const match = String(content).match(
        /export\s+const\s+VERSION\s*=\s*(\d+)\s*;?/
    );

    return match ? Number(match[1]) : 0;
}

export function getSourceVersion(ns, file) {
    if (!ns.fileExists(file, "home")) {
        return null;
    }

    return parseVersion(ns.read(file));
}

export function compareVersions(source, execution) {
    if (source === null) return "NO_SOURCE";
    if (execution === null) return "UNKNOWN";
    if (execution < source) return "OUTDATED";
    if (execution > source) return "SUPERIOR";

    return "CURRENT";
}
