# oct-network-dhcp — Implementation Phases

- [x] Phase 1: Scaffold (package.json, webpack, Containerfile, nginx, console-extensions, deploy/, .cursor/rules, AGENTS.md, README)
- [x] Phase 2: K8s models (NAD, Namespace, Deployment, ConfigMap, VMI, Pod)
- [x] Phase 3: Core logic (dnsmasq config generation, NAD parsing, VMI matching, inventory)
- [x] Phase 4: Create DHCP tab UI (NAD picker, IP config, pool, gateway, DNS, name, review + create)
- [x] Phase 5: Manage DHCP tab UI (server list, detail panel, edit settings, reservations with VM picker)
- [x] Phase 6: i18n (all user-facing strings)
- [ ] Phase 7: Build + push images (1.0.0-ocp4.22, 1.0.0-ocp4.21)
- [ ] Phase 8: Storefront integration (icon, tile, deploy bundle, BUNDLED_DEPLOY, validate)
