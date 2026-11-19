export function normalizePath(path) {
    return String(path).replace(/^\/+/, "");
}

export function getWorkerProcesses(ns, host, worker) {
    const expected = normalizePath(worker.file);

    return ns.ps(host).filter(
        p => normalizePath(p.filename) === expected
    );
}

export function getExecutionVersion(ns, pid) {
    const logs = ns.getScriptLogs(pid);

    for (let i = logs.length - 1; i >= 0; i--) {
        const match = String(logs[i]).match(
            /MASTER_VERSION:(\d+)/
        );

        if (match) return Number(match[1]);
    }

    return null;
}