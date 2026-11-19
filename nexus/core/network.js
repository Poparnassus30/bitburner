/** @param {NS} ns */

export function discoverNetwork(ns, start = "home") {
    const visited = new Set([start]);
    const queue = [start];

    while (queue.length > 0) {
        const host = queue.shift();

        for (const neighbor of ns.scan(host)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    return [...visited];
}
