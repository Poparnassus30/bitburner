/** @param {NS} ns */

import {
    calculateThreads
} from "/nexus/core/resources.js";

import {
    getWorkerProcesses,
    getExecutionVersion
} from "/nexus/core/processes.js";

import {
    getSourceVersion
} from "/nexus/services/versions.js";

import {
    getDeployment,
    setDeployment,
    saveRegistry
} from "/nexus/services/registry.js";

export async function inspectWorker(
    ns,
    host,
    worker,
    config,
    registry
) {
    const sourceVersion = getSourceVersion(
        ns, worker.file
    );

    if (sourceVersion === null) {
        ns.print(`SOURCE ABSENTE : ${worker.file}`);
        return;
    }

    if (sourceVersion === 0) {
        ns.print(`SOURCE NON VERSIONNEE : ${worker.file}`);
        return;
    }

    const existing = getWorkerProcesses(
        ns, host, worker
    );

    const deployment = getDeployment(
        registry, host, worker.file
    );

    let updateRequired = existing.length === 0;

    for (const process of existing) {
        const announced = getExecutionVersion(
            ns, process.pid
        );

        const recorded = deployment?.processes?.find(
            item => item.pid === process.pid
        );

        // Une ancienne instance sans version est V0.
        const version =
            announced ?? recorded?.version ?? 0;

        if (version > sourceVersion) {
            ns.print(
                `ALERTE ${host}: version V${version} ` +
                `superieure a V${sourceVersion}`
            );
            return;
        }

        if (version < sourceVersion) {
            updateRequired = true;
        }
    }

    // Si le registre indique un fichier ancien,
    // demander également sa synchronisation.
    if (
        deployment &&
        deployment.hostVersion < sourceVersion
    ) {
        updateRequired = true;
    }

    if (!updateRequired) {
        return;
    }

    if (
        existing.length > 0 &&
        !worker.autoUpdate
    ) {
        ns.print(`UPDATE DESACTIVE : ${host}`);
        return;
    }

    const capacity = calculateThreads(
        ns, host, worker, config, existing
    );

    // Préserver les instances existantes.
    const jobs = existing.length > 0
        ? existing.map(p => ({
            threads: p.threads,
            args: [...p.args]
        }))
        : [{
            threads: capacity,
            args: [worker.target]
        }];

    const requiredThreads = jobs.reduce(
        (sum, job) => sum + job.threads, 0
    );

    if (
        capacity < requiredThreads ||
        requiredThreads < 1
    ) {
        ns.print(
            `RAM INSUFFISANTE ${host}: ` +
            `${requiredThreads} threads demandes, ` +
            `${capacity} possibles`
        );
        return;
    }

    // ======================================
    // SIMULATION
    // ======================================

    if (config.dryRun) {
        ns.print(
            `[SIMULATION] ${host}: ` +
            `${worker.file} -> V${sourceVersion} | ` +
            `${jobs.length} processus | ` +
            `${requiredThreads} threads`
        );
        return;
    }

    // ======================================
    // DEPLOIEMENT REEL
    // ======================================

    // Copier avant d'arrêter les programmes.
    if (host !== config.source) {
        const copied = ns.scp(
            worker.file,
            host,
            config.source
        );

        if (!copied) {
            ns.print(`ECHEC SCP : ${host}`);
            return;
        }
    }

    // Arrêter uniquement les processus concernés.
    for (const process of existing) {
        const killed = ns.kill(process.pid);

        if (!killed) {
            ns.print(
                `ECHEC ARRET ${host}: PID ${process.pid}`
            );
            return;
        }
    }

    await ns.sleep(100);

    const launched = [];

    for (const job of jobs) {
        const pid = ns.exec(
            worker.file,
            host,
            job.threads,
            ...job.args
        );

        if (pid === 0) {
            ns.print(
                `ECHEC EXEC : ${host} ${worker.file}`
            );
            continue;
        }

        launched.push({
            pid,
            version: sourceVersion,
            threads: job.threads,
            args: job.args
        });
    }

    // La copie et l'exécution sont suivies
    // séparément dans le registre.
    setDeployment(
        registry,
        host,
        worker.file,
        {
            hostVersion: sourceVersion,
            status:
                launched.length === jobs.length
                    ? "STARTED"
                    : "PARTIAL",
            processes: launched
        }
    );

    await saveRegistry(
        ns,
        config.registry,
        registry
    );

    ns.tprint(
        `DEPLOY ${host}: ${worker.file} V${sourceVersion}` +
        ` | ${launched.length}/${jobs.length} processus`
    );
}
