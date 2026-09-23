# AGENTS.md — Network DHCP (OCT extension)

This is **OpenShift Community Tools (OCT)**, a **community project**, not an official Red Hat supported product. Do not describe it as official Red Hat software.

This repository is the **Network DHCP** ConsolePlugin: create and manage dnsmasq DHCP servers on NAD VLAN networks. It is **not** the OCT storefront. Catalog hubs live in `oct-storefront`. Network Bond lives in `oct-network-bond`. Network Bridge lives in `oct-network-bridge`. Network VLAN lives in `oct-network-vlan`. Bare Metal Hosts lives in `oct-baremetal`.

## Identifiers

| | Value |
| --- | --- |
| Plugin ID / ConsolePlugin / `package.json` `consolePlugin.name` | **`oct-network-dhcp`** |
| Image | `quay.io/cjanisze/oct-network-dhcp:1.0.0-ocp4.22` (`<semver>-ocp<major.minor>`) |
| i18n | `plugin__oct-network-dhcp` |

Display name is **Network DHCP**. No PVC or discovery sidecar for the plugin itself.

**Current version:** `1.0.0` (package.json / consolePlugin.version).

## Architecture (short)

| Piece | Role |
| --- | --- |
| Console dynamic plugin (`src/`, `console-extensions.json`) | DHCP server management route. Kubernetes API via Console SDK. |
| Plugin nginx container (`Containerfile`, `deploy/`) | Serves webpack `dist/`. ConsolePlugin **oct-network-dhcp**. |

No sidecar for the plugin. The plugin creates Deployments that run a companion dnsmasq container image on the cluster.

## Exposed modules

| Module | Route | Description |
| --- | --- | --- |
| `NetworkDhcpPage` | `/community-tools/network/dhcp` | Two-tab page: **Create DHCP Server** (NAD picker, IP config, pool, gateway, DNS, review + create) and **Manage DHCP Servers** (server list, detail panel, edit settings, reservations with VM discovery). |

## What this plugin creates

- **SecurityContextConstraints** `oct-dhcp-netraw` — custom cluster-wide SCC allowing `NET_RAW`, `NET_BIND_SERVICE`, and `NET_ADMIN` capabilities (created once, reused by all DHCP servers)
- **ClusterRole** `oct-dhcp-netraw-use` — grants `use` verb on the custom SCC (created once)
- **ServiceAccount** per DHCP server — scoped to the target namespace
- **ClusterRoleBinding** per DHCP server — binds the ServiceAccount to the custom SCC ClusterRole (automatically cleaned up on delete)
- **ConfigMap** with `dnsmasq.conf` content for DHCP server configuration
- **Deployment** running the `oct-network-dhcp-server` (dnsmasq) container as root (UID 0), attached to a NAD network via Multus annotation, with `NET_RAW`, `NET_BIND_SERVICE`, and `NET_ADMIN` capabilities
- Labels: `app.kubernetes.io/managed-by: oct-network-dhcp`, `oct-dhcp/nad-name`, `oct-dhcp/nad-namespace`

## Companion images

The plugin creates Deployments that reference a sidecar image with its own independent version.

| Image | Current version | Quay repo |
| --- | --- | --- |
| `oct-network-dhcp-server` | **1.0.0** | `quay.io/cjanisze/oct-network-dhcp-server` |

The discovery-service/dnsmasq server version (`1.0.0`) is independent of the plugin version (`1.0.0`). After rebuilding either image, update the deploy YAML in the storefront, rebuild the storefront image, and run `scripts/validate-catalog.sh`. See `oct-release-checklist.mdc`.

## K8s resources watched/created

| Resource | Scope | Purpose |
| --- | --- | --- |
| `NetworkAttachmentDefinition` (k8s.cni.cncf.io/v1) | namespaced | NAD picker for target network |
| `Namespace` (v1) | cluster | Namespace picker for target namespace |
| `Deployment` (apps/v1) | namespaced | Create/manage dnsmasq server Deployments |
| `ConfigMap` (v1) | namespaced | Store dnsmasq.conf configuration |
| `VirtualMachineInstance` (kubevirt.io/v1) | namespaced | Discover VM MACs for DHCP reservations |
| `Pod` (v1) | namespaced | Monitor DHCP server pod status |
| `SecurityContextConstraints` (security.openshift.io/v1) | cluster | Create the `oct-dhcp-netraw` SCC |
| `ClusterRole` (rbac.authorization.k8s.io/v1) | cluster | Create the `oct-dhcp-netraw-use` role |

## DHCP server architecture

Each DHCP server consists of:
1. A **SecurityContextConstraints** `oct-dhcp-netraw` (cluster-scoped, shared by all DHCP servers) — allows `NET_RAW`, `NET_BIND_SERVICE`, `NET_ADMIN`
2. A **ClusterRole** `oct-dhcp-netraw-use` (cluster-scoped, shared) — grants `use` on the SCC
3. A **ServiceAccount** per server (namespaced)
4. A **ClusterRoleBinding** per server — binds the SA to the ClusterRole
5. A **ConfigMap** containing `dnsmasq.conf` with pool range, gateway, DNS, and static reservations
6. A **Deployment** running the `oct-network-dhcp-server` image (dnsmasq) as root (UID 0), attached to the target NAD network via Multus `k8s.v1.cni.cncf.io/networks` annotation with a static IP
7. An **emptyDir** volume at `/var/lib/dnsmasq/` for the lease file
8. `securityContext.capabilities.add: ['NET_RAW', 'NET_BIND_SERVICE', 'NET_ADMIN']` and `runAsUser: 0` — dnsmasq needs raw sockets, privileged port 67 binding, and network administration

## OpenShift and extension versions

Two axes in the catalog: git tag **`v1.x.x`** (semver) and optional branch **`ocp-X.Y`** when PatternFly or APIs diverge. Image tags **always** `<semver>-ocp<major.minor>` (e.g. `1.0.0-ocp4.22`). Storefront Add installs the newest stable semver compatible with the cluster; Update is explicit; one ConsolePlugin name runs one version.

- Git: `main` tracks the newest supported minor (currently **4.22**). Optional `ocp-4.22`, `ocp-4.21`.
- Images: `oct-network-dhcp:1.0.0-ocp4.22` and `:1.0.0-ocp4.21`. **Always publish both** OpenShift minor tags (same digest if bits match). Catalog `versions[].image` must be the combined tag.
- PatternFly 6 on 4.22; do not mix PF majors on one branch.

## Navigation (React Router v6 via v5-compat)

Uses `useNavigate` from `react-router-dom-v5-compat` (^6.30.0). Breadcrumb and "Back to Network" navigate to `/community-tools/network`. Route registered at `/community-tools/network/dhcp` via `console-extensions.json`.

This plugin **does not** register the Community Tools section or hubs. Open from the storefront Network hub.

## PatternFly 6

No PatternFly CSS imports. CSS prefix `netdhcp-`.

## No environment-specific hardcoding

Never bake in lab networks, StorageClasses, hostnames, or similar. NADs, IPs, and DHCP configuration come from the user's form and live cluster state. See `.cursor/rules/oct-no-env-hardcoding.mdc`.

## Catalog tile

Storefront `catalog/community.yaml`: `metadata.name: oct-network-dhcp`, `consolePlugin: oct-network-dhcp`, `spec.href: /community-tools/network/dhcp` (must match `console-extensions.json`), `spec.versions[]` with semver + `openshift` and a **public combined image tag that exists**.

## Add must go Ready

Storefront **Add** can succeed while the plugin never becomes Ready (**Open** 404s). Follow **oct-storefront** `docs/extension-standard.md`: catalog `versions[].image` must be the **combined** tag `<semver>-ocp<major.minor>`, **exist**, and be **public** (no pull secret); confirm the plugin Deployment is Running. This plugin has no PVC or discovery sidecar.

## Do-not-break list

Do **not** change unless you are deliberately migrating a live cluster:

- Route `/community-tools/network/dhcp`
- DHCP server create/manage and dnsmasq config generation behavior
- Plugin ID `oct-network-dhcp`

## Verify

```bash
yarn install
yarn build
```
