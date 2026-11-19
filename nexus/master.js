
/** @param {NS} ns */

import { CONFIG } from "/nexus/config/config.js";
import { WORKERS } from "/nexus/config/workers.js";

import {
    discoverNetwork
} from "/nexus/core/network.js";

import {
    acquireRoot
} from "/nexus/core/access.js";

import {
    loadRegistry
} from "/nexus/services/registry.js";

import {
    inspectWorker
} from "/nexus/services/deployment.js";

export const VERSION = 2;

export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== CONFIG.source) {
        ns.tprint(
            "ERREUR: NEXUS MASTER doit tourner sur home."
        );
        return;
    }

    const registry = loadRegistry(
        ns, CONFIG.registry
    );

    ns.tprint(
        `NEXUS MASTER V${VERSION} - Demarrage`
    );

    ns.tprint(
        CONFIG.dryRun
            ? "MODE SIMULATION"
            : "MODE DEPLOIEMENT"
    );

    while (true) {
        try {
            const servers = discoverNetwork(
                ns, CONFIG.source
            );

            ns.print(
                `Inspection: ${servers.length} serveurs`
            );

            for (const host of servers) {
                // Filtrage pour les tests
                if (
                    CONFIG.deployHosts.length > 0 &&
                    !CONFIG.deployHosts.includes(host)
                ) {
                    continue;
                }

                try {
                    if (!acquireRoot(
                        ns, host, CONFIG
                    )) {
                        continue;
                    }

                    if (
                        ns.getServerMaxRam(host) <= 0
                    ) {
                        continue;
                    }

                    for (const worker of WORKERS) {
                        if (!worker.enabled) {
                            continue;
                        }

                        await inspectWorker(
                            ns,
                            host,
                            worker,
                            CONFIG,
                            registry
                        );
                    }

                } catch (error) {
                    ns.print(
                        `ERREUR ${host}: ${String(error)}`
                    );
                }
            }

        } catch (error) {
            ns.print(
                `ERREUR MASTER: ${String(error)}`
            );
        }

        await ns.sleep(CONFIG.refresh);
    }
}
