
export function loadRegistry(ns, path) {
    try {
        const content = ns.read(path);

        if (!content || !content.trim()) {
            return {};
        }

        const data = JSON.parse(content);

        if (
            data === null ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            return {};
        }

        return data;
    } catch (error) {
        ns.print(`REGISTRY READ ERROR: ${String(error)}`);
        return {};
    }
}

export function saveRegistry(ns, path, registry) {
    try {
        ns.write(
            path,
            JSON.stringify(registry, null, 2),
            "w"
        );

        ns.print(`REGISTRY SAVED: ${path}`);
        return true;
    } catch (error) {
        ns.print(`REGISTRY WRITE ERROR: ${String(error)}`);
        return false;
    }
}

export function getDeployment(registry, host, file) {
    return registry[host]?.[file] ?? null;
}

export function setDeployment(
    registry,
    host,
    file,
    data
) {
    if (!registry[host]) {
        registry[host] = {};
    }

    registry[host][file] = {
        ...data,
        updatedAt: Date.now()
    };
}
