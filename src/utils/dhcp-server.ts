/**
 * dnsmasq DHCP server config generation, NAD parsing, VMI discovery,
 * inventory, and IP validation for the Network DHCP tool.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DhcpReservation = {
  mac: string;
  ip: string;
  hostname?: string;
  source?: 'vm' | 'manual';
};

export type DhcpServerConfig = {
  serverIp: string;
  netmask: string;
  poolStart: string;
  poolEnd: string;
  leaseTime: string;
  gateway: string;
  dnsServers: string[];
  reservations: DhcpReservation[];
};

export type NetworkAttachmentDefinitionKind = {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: {
    config?: string;
  };
};

export type VirtualMachineInstanceKind = {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
  };
  spec?: {
    networks?: Array<{
      name: string;
      multus?: {
        networkName: string;
      };
    }>;
  };
  status?: {
    interfaces?: Array<{
      name: string;
      mac?: string;
      ipAddress?: string;
    }>;
  };
};

export type NamespaceKind = {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
};

export type DhcpServerInventoryItem = {
  name: string;
  namespace: string;
  nadName: string;
  nadNamespace: string;
  config: DhcpServerConfig | null;
  podStatus: string;
  deploymentName: string;
  configMapName: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MANAGED_BY = 'oct-network-dhcp';
const DHCP_SERVER_IMAGE = 'quay.io/cjanisze/oct-network-dhcp-server:1.0.0-ocp4.22';
const DHCP_SCC_NAME = 'oct-dhcp-netraw';
const DHCP_CLUSTERROLE_NAME = 'oct-dhcp-netraw-use';

/* ------------------------------------------------------------------ */
/*  IP validation helpers                                              */
/* ------------------------------------------------------------------ */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function ipToNum(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function numToIp(num: number): string {
  return [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ].join('.');
}

export function cidrToNetmask(prefix: number): string {
  if (prefix < 0 || prefix > 32) return '255.255.255.0';
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return numToIp(mask);
}

export function netmaskToCidr(netmask: string): number {
  const num = ipToNum(netmask);
  let bits = 0;
  let val = num;
  while (val & 0x80000000) {
    bits++;
    val = (val << 1) >>> 0;
  }
  return bits;
}

export function ipInSubnet(ip: string, serverIp: string, netmask: string): boolean {
  if (!IPV4.test(ip) || !IPV4.test(serverIp) || !IPV4.test(netmask)) return false;
  const maskNum = ipToNum(netmask);
  return (ipToNum(ip) & maskNum) === (ipToNum(serverIp) & maskNum);
}

export function suggestPool(serverIp: string, netmask: string): { start: string; end: string } {
  if (!IPV4.test(serverIp) || !IPV4.test(netmask)) {
    return { start: '', end: '' };
  }
  const ipNum = ipToNum(serverIp);
  const maskNum = ipToNum(netmask);
  const network = (ipNum & maskNum) >>> 0;
  const broadcast = (network | (~maskNum >>> 0)) >>> 0;
  const hostCount = broadcast - network - 1;

  if (hostCount < 2) {
    return { start: serverIp, end: serverIp };
  }

  const startNum = network + 10;
  const endNum = broadcast - 1;

  return {
    start: startNum <= broadcast ? numToIp(Math.min(startNum, endNum)) : numToIp(network + 2),
    end: numToIp(endNum),
  };
}

export function suggestGateway(serverIp: string): string {
  if (!IPV4.test(serverIp)) return '';
  const parts = serverIp.split('.');
  parts[3] = '1';
  return parts.join('.');
}

/* ------------------------------------------------------------------ */
/*  dnsmasq config generation                                          */
/* ------------------------------------------------------------------ */

export function generateDnsmasqConf(config: DhcpServerConfig): string {
  const lines: string[] = [];
  lines.push('interface=net1');
  lines.push('bind-interfaces');
  lines.push(`dhcp-range=${config.poolStart},${config.poolEnd},${config.netmask},${config.leaseTime}`);

  if (config.gateway) {
    lines.push(`dhcp-option=3,${config.gateway}`);
  }

  if (config.dnsServers.length > 0) {
    lines.push(`dhcp-option=6,${config.dnsServers.join(',')}`);
  }

  for (const res of config.reservations) {
    const parts = [res.mac, res.ip];
    if (res.hostname) parts.push(res.hostname);
    lines.push(`dhcp-host=${parts.join(',')}`);
  }

  lines.push('dhcp-leasefile=/var/lib/dnsmasq/dnsmasq.leases');
  lines.push('no-resolv');

  for (const dns of config.dnsServers) {
    lines.push(`server=${dns}`);
  }

  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/*  dnsmasq config parsing                                             */
/* ------------------------------------------------------------------ */

export function parseDnsmasqConf(conf: string): DhcpServerConfig {
  const config: DhcpServerConfig = {
    serverIp: '',
    netmask: '255.255.255.0',
    poolStart: '',
    poolEnd: '',
    leaseTime: '12h',
    gateway: '',
    dnsServers: [],
    reservations: [],
  };

  const dnsFromOption: string[] = [];
  const dnsFromServer: string[] = [];

  for (const rawLine of conf.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('dhcp-range=')) {
      const parts = line.slice('dhcp-range='.length).split(',');
      if (parts.length >= 2) {
        config.poolStart = parts[0];
        config.poolEnd = parts[1];
      }
      if (parts.length >= 3 && IPV4.test(parts[2])) {
        config.netmask = parts[2];
      }
      if (parts.length >= 4) {
        config.leaseTime = parts[parts.length - 1];
      }
    } else if (line.startsWith('dhcp-option=3,')) {
      config.gateway = line.slice('dhcp-option=3,'.length).trim();
    } else if (line.startsWith('dhcp-option=6,')) {
      const dns = line.slice('dhcp-option=6,'.length).split(',').map((s) => s.trim()).filter(Boolean);
      dnsFromOption.push(...dns);
    } else if (line.startsWith('server=')) {
      dnsFromServer.push(line.slice('server='.length).trim());
    } else if (line.startsWith('dhcp-host=')) {
      const parts = line.slice('dhcp-host='.length).split(',');
      if (parts.length >= 2) {
        const reservation: DhcpReservation = {
          mac: parts[0],
          ip: parts[1],
          source: 'manual',
        };
        if (parts.length >= 3) {
          reservation.hostname = parts[2];
        }
        config.reservations.push(reservation);
      }
    }
  }

  config.dnsServers = dnsFromOption.length > 0 ? dnsFromOption : dnsFromServer;

  return config;
}

/* ------------------------------------------------------------------ */
/*  Resource generation                                                */
/* ------------------------------------------------------------------ */

export function buildDhcpConfigMap(opts: {
  name: string;
  namespace: string;
  nadName: string;
  nadNamespace: string;
  config: DhcpServerConfig;
}): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: opts.name,
      namespace: opts.namespace,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
        'oct-dhcp/nad-name': opts.nadName,
        'oct-dhcp/nad-namespace': opts.nadNamespace,
      },
    },
    data: {
      'dnsmasq.conf': generateDnsmasqConf(opts.config),
    },
  };
}

export function dhcpServiceAccountName(serverName: string): string {
  return `dhcp-${serverName}`.slice(0, 253);
}

export function dhcpClusterRoleBindingName(serverName: string, namespace: string): string {
  return `oct-dhcp-${serverName}-${namespace}`.slice(0, 253);
}

export function buildDhcpServiceAccount(opts: {
  name: string;
  namespace: string;
}): Record<string, unknown> {
  const saName = dhcpServiceAccountName(opts.name);
  return {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: {
      name: saName,
      namespace: opts.namespace,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
      },
    },
  };
}

export function buildDhcpScc(): Record<string, unknown> {
  return {
    apiVersion: 'security.openshift.io/v1',
    kind: 'SecurityContextConstraints',
    metadata: {
      name: DHCP_SCC_NAME,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
      },
    },
    allowedCapabilities: ['NET_RAW', 'NET_BIND_SERVICE', 'NET_ADMIN'],
    allowPrivilegeEscalation: true,
    allowPrivilegedContainer: false,
    allowHostDirVolumePlugin: false,
    allowHostIPC: false,
    allowHostNetwork: false,
    allowHostPID: false,
    allowHostPorts: false,
    defaultAddCapabilities: null,
    requiredDropCapabilities: ['MKNOD'],
    fsGroup: { type: 'RunAsAny' },
    runAsUser: { type: 'RunAsAny' },
    seLinuxContext: { type: 'MustRunAs' },
    supplementalGroups: { type: 'RunAsAny' },
    volumes: ['configMap', 'emptyDir', 'projected', 'secret', 'downwardAPI', 'persistentVolumeClaim'],
    users: [],
    groups: [],
  };
}

export function buildDhcpSccClusterRole(): Record<string, unknown> {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    metadata: {
      name: DHCP_CLUSTERROLE_NAME,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
      },
    },
    rules: [
      {
        apiGroups: ['security.openshift.io'],
        resources: ['securitycontextconstraints'],
        resourceNames: [DHCP_SCC_NAME],
        verbs: ['use'],
      },
    ],
  };
}

export function buildDhcpSccRoleBinding(opts: {
  name: string;
  namespace: string;
}): Record<string, unknown> {
  const saName = dhcpServiceAccountName(opts.name);
  const crbName = dhcpClusterRoleBindingName(opts.name, opts.namespace);
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    metadata: {
      name: crbName,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
      },
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: DHCP_CLUSTERROLE_NAME,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: saName,
        namespace: opts.namespace,
      },
    ],
  };
}

export function buildDhcpDeployment(opts: {
  name: string;
  namespace: string;
  nadName: string;
  nadNamespace: string;
  serverIp: string;
  netmask: string;
  configMapName: string;
  dhcpServerImage?: string;
}): Record<string, unknown> {
  const prefix = netmaskToCidr(opts.netmask);
  const networkAnnotation = JSON.stringify([
    {
      name: opts.nadName,
      namespace: opts.nadNamespace,
      ips: [`${opts.serverIp}/${prefix}`],
    },
  ]);
  const image = opts.dhcpServerImage || DHCP_SERVER_IMAGE;

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: opts.name,
      namespace: opts.namespace,
      labels: {
        'app.kubernetes.io/managed-by': MANAGED_BY,
        'oct-dhcp/nad-name': opts.nadName,
        'oct-dhcp/nad-namespace': opts.nadNamespace,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          'app.kubernetes.io/managed-by': MANAGED_BY,
          'app.kubernetes.io/instance': opts.name,
        },
      },
      template: {
        metadata: {
          labels: {
            'app.kubernetes.io/managed-by': MANAGED_BY,
            'app.kubernetes.io/instance': opts.name,
          },
          annotations: {
            'k8s.v1.cni.cncf.io/networks': networkAnnotation,
          },
        },
        spec: {
          serviceAccountName: dhcpServiceAccountName(opts.name),
          containers: [
            {
              name: 'dnsmasq',
              image,
              volumeMounts: [
                {
                  name: 'dnsmasq-config',
                  mountPath: '/etc/dnsmasq.d/',
                  readOnly: true,
                },
                {
                  name: 'dnsmasq-leases',
                  mountPath: '/var/lib/dnsmasq/',
                },
              ],
              securityContext: {
                runAsUser: 0,
                capabilities: {
                  add: ['NET_RAW', 'NET_BIND_SERVICE', 'NET_ADMIN'],
                },
              },
              resources: {
                requests: { cpu: '10m', memory: '32Mi' },
                limits: { cpu: '100m', memory: '64Mi' },
              },
            },
          ],
          volumes: [
            {
              name: 'dnsmasq-config',
              configMap: {
                name: opts.configMapName,
              },
            },
            {
              name: 'dnsmasq-leases',
              emptyDir: {},
            },
          ],
        },
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/*  NAD parsing                                                        */
/* ------------------------------------------------------------------ */

export function parseNadBridge(nad: NetworkAttachmentDefinitionKind): {
  bridgeName: string;
  vlanId?: number;
  type?: string;
} {
  if (!nad.spec?.config) return { bridgeName: '' };
  try {
    const parsed = JSON.parse(nad.spec.config);
    return {
      bridgeName: parsed.bridge || '',
      vlanId: parsed.vlan !== undefined ? Number(parsed.vlan) : undefined,
      type: parsed.type || '',
    };
  } catch {
    return { bridgeName: '' };
  }
}

export function isOvnNad(nad: NetworkAttachmentDefinitionKind): boolean {
  if (!nad.spec?.config) return false;
  try {
    const parsed = JSON.parse(nad.spec.config);
    const cniType = (parsed.type || '').toLowerCase();
    return cniType === 'ovn-k8s-cni-overlay' || cniType === 'ovn-cni';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  VM discovery                                                       */
/* ------------------------------------------------------------------ */

export function discoverVmsOnNad(
  vmis: VirtualMachineInstanceKind[],
  nadName: string,
  nadNamespace: string,
): Array<{ vmName: string; vmNamespace: string; mac: string; ip?: string; interfaceName: string }> {
  const results: Array<{
    vmName: string;
    vmNamespace: string;
    mac: string;
    ip?: string;
    interfaceName: string;
  }> = [];

  for (const vmi of vmis) {
    const networks = vmi.spec?.networks || [];
    const statusIfaces = vmi.status?.interfaces || [];

    for (const net of networks) {
      if (!net.multus) continue;
      const multusName = net.multus.networkName;
      const fullNadRef = `${nadNamespace}/${nadName}`;
      if (multusName !== nadName && multusName !== fullNadRef) continue;

      const statusIface = statusIfaces.find((si) => si.name === net.name);
      if (statusIface?.mac) {
        results.push({
          vmName: vmi.metadata.name,
          vmNamespace: vmi.metadata.namespace,
          mac: statusIface.mac,
          ip: statusIface.ipAddress,
          interfaceName: net.name,
        });
      }
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

type K8sBase = {
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  data?: Record<string, string>;
  status?: Record<string, unknown>;
};

type PodLike = K8sBase & {
  status?: {
    phase?: string;
  };
};

type DeploymentLike = K8sBase;

export function listDhcpServers(
  deployments: DeploymentLike[],
  configMaps: K8sBase[],
  pods: PodLike[],
): DhcpServerInventoryItem[] {
  const items: DhcpServerInventoryItem[] = [];
  const cmByKey = new Map<string, K8sBase>();

  for (const cm of configMaps) {
    const labels = cm.metadata.labels || {};
    if (labels['app.kubernetes.io/managed-by'] !== MANAGED_BY) continue;
    cmByKey.set(`${cm.metadata.namespace}/${cm.metadata.name}`, cm);
  }

  for (const dep of deployments) {
    const labels = dep.metadata.labels || {};
    if (labels['app.kubernetes.io/managed-by'] !== MANAGED_BY) continue;

    const nadName = labels['oct-dhcp/nad-name'] || '';
    const nadNamespace = labels['oct-dhcp/nad-namespace'] || '';
    const ns = dep.metadata.namespace || '';

    const matchingPods = pods.filter((p) => {
      const pl = p.metadata.labels || {};
      return (
        pl['app.kubernetes.io/managed-by'] === MANAGED_BY &&
        pl['app.kubernetes.io/instance'] === dep.metadata.name &&
        p.metadata.namespace === ns
      );
    });

    const podStatus =
      matchingPods.length > 0
        ? (matchingPods[0].status?.phase || 'Unknown')
        : 'No pods';

    const cmName = dep.metadata.name;
    const cm = cmByKey.get(`${ns}/${cmName}`);
    let config: DhcpServerConfig | null = null;
    if (cm?.data?.['dnsmasq.conf']) {
      config = parseDnsmasqConf(cm.data['dnsmasq.conf']);
    }

    items.push({
      name: dep.metadata.name,
      namespace: ns,
      nadName,
      nadNamespace,
      config,
      podStatus,
      deploymentName: dep.metadata.name,
      configMapName: cmName,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/* ------------------------------------------------------------------ */
/*  Error helpers                                                      */
/* ------------------------------------------------------------------ */

export function getK8sErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const obj = err as {
    message?: string;
    json?: { message?: string; code?: number };
    status?: number;
  };
  return obj.json?.message || obj.message || String(err);
}

/* ------------------------------------------------------------------ */
/*  Name helpers                                                       */
/* ------------------------------------------------------------------ */

export function suggestServerName(nadName: string): string {
  const sanitized = nadName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `dhcp-${sanitized || 'server'}`.slice(0, 253);
}
