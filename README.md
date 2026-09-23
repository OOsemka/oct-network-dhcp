# Network DHCP (OpenShift Community Tools)

**Community project. Not officially supported by Red Hat.**

Standalone OpenShift Console plugin that creates and manages dnsmasq DHCP servers on NAD VLAN networks. Deploys a dnsmasq container attached to the target network via Multus, with configurable DHCP pools, gateways, DNS servers, and static MAC reservations (including VM discovery from KubeVirt VirtualMachineInstances).

- **Plugin ID:** `oct-network-dhcp`
- **Version:** `1.0.0`
- **Image:** `quay.io/cjanisze/oct-network-dhcp:1.0.0-ocp4.22` and `:1.0.0-ocp4.21` (`<semver>-ocp<major.minor>`; always publish both minors)

Validated on OpenShift **4.22** (PatternFly 6). Open from **Community Tools → Network** after the storefront (`oct-storefront`) and this plugin are enabled.

## Features

- **NAD Selection:** Pick any NetworkAttachmentDefinition from cluster namespaces as the target network.
- **DHCP Server Creation:** Deploys a dnsmasq container with a Multus-attached static IP on the target NAD.
- **Pool Configuration:** Configurable DHCP range, gateway, DNS servers, and lease time.
- **VM Discovery:** Discovers VirtualMachineInstance MACs on the target NAD for static DHCP reservations.
- **Server Management:** List, edit, and delete DHCP servers. Modify pool settings and reservations.
- **Inventory:** Lists DHCP servers managed by this tool (label `app.kubernetes.io/managed-by: oct-network-dhcp`).

## Navigation

Route: `/community-tools/network/dhcp`. Uses `useNavigate` from `react-router-dom-v5-compat`.

```bash
yarn install
yarn build
```

Deploy: edit the image in `deploy/install.yaml`, `oc apply -f deploy/install.yaml` (only when asked), then enable `oct-network-dhcp` in `consoles.operator.openshift.io/cluster` `spec.plugins` (or use the storefront **Add** action).

## Contributing — cluster-portable code

Do **not** hardcode environment-specific values (IPs, CIDRs, NAD names, StorageClasses, hostnames). The UI reads live NADs and VMIs; the user supplies the DHCP configuration. Agents: `.cursor/rules/oct-no-env-hardcoding.mdc`.
