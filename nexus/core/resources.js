/** @param {NS} ns */

export function getFreeRam(ns, host, config) {
    const maximum = ns.getServerMaxRam(host);
    const used = ns.getServerUsedRam(host);

    const reserve =
        host === config.source
            ? config.reserveHome
            : 0;

    return Math.max(
        0,
        maximum - used - reserve
    );
}

export function calculateThreads(
    ns,
    host,
    worker,
    config,
    replacing = []
) {
    const cost = ns.getScriptRam(
        worker.file,
        config.source
    );

    if (cost <= 0) return 0;

    // RAM récupérable après arrêt des anciens workers
    let reclaimable = 0;

    for (const process of replacing) {
        reclaimable +=
            ns.getScriptRam(process.filename, host) *
            process.threads;
    }

    const available =
        getFreeRam(ns, host, config) + reclaimable;

    return Math.max(
        0,
        Math.floor((available + 0.000001) / cost)
    );
}
