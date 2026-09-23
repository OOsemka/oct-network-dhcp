import {
  K8sResourceCommon,
  DocumentTitle,
  ListPageHeader,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom-v5-compat';
import {
  Breadcrumb,
  BreadcrumbItem,
  Bullseye,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Tab,
  Tabs,
  TabTitleText,
} from '@patternfly/react-core';
import React, { FC, useCallback, useMemo, useState } from 'react';

import {
  NetworkAttachmentDefinitionModel,
  NamespaceModel,
  DeploymentModel,
  ConfigMapModel,
  VirtualMachineInstanceModel,
  PodModel,
} from '../utils/k8s-resources';
import {
  NetworkAttachmentDefinitionKind,
  NamespaceKind,
  VirtualMachineInstanceKind,
  listDhcpServers,
} from '../utils/dhcp-server';
import CommunityDisclaimer from './CommunityDisclaimer';
import CreateDhcpTab from './CreateDhcpTab';
import ManageDhcpTab from './ManageDhcpTab';

import './network-dhcp.css';

const MANAGED_BY_SELECTOR = 'app.kubernetes.io/managed-by=oct-network-dhcp';

const NetworkDhcpPage: FC = () => {
  const { t } = useTranslation('plugin__oct-network-dhcp');
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string | number>(0);

  /* ---- K8s watches ---- */
  const [nadList, nadsLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: {
      group: NetworkAttachmentDefinitionModel.apiGroup,
      version: NetworkAttachmentDefinitionModel.apiVersion,
      kind: NetworkAttachmentDefinitionModel.kind,
    },
    isList: true,
    namespaced: true,
  });

  const [nsList, nsLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: {
      group: '',
      version: NamespaceModel.apiVersion,
      kind: NamespaceModel.kind,
    },
    isList: true,
    namespaced: false,
  });

  const [depList, depsLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: {
      group: DeploymentModel.apiGroup,
      version: DeploymentModel.apiVersion,
      kind: DeploymentModel.kind,
    },
    isList: true,
    namespaced: true,
    selector: { matchLabels: { 'app.kubernetes.io/managed-by': 'oct-network-dhcp' } },
  });

  const [cmList, cmsLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: {
      group: '',
      version: ConfigMapModel.apiVersion,
      kind: ConfigMapModel.kind,
    },
    isList: true,
    namespaced: true,
    selector: { matchLabels: { 'app.kubernetes.io/managed-by': 'oct-network-dhcp' } },
  });

  const [vmiList, vmisLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: {
      group: VirtualMachineInstanceModel.apiGroup,
      version: VirtualMachineInstanceModel.apiVersion,
      kind: VirtualMachineInstanceModel.kind,
    },
    isList: true,
    namespaced: true,
    optional: true,
  });

  const [podList, podsLoaded] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: {
      group: '',
      version: PodModel.apiVersion,
      kind: PodModel.kind,
    },
    isList: true,
    namespaced: true,
    selector: { matchLabels: { 'app.kubernetes.io/managed-by': 'oct-network-dhcp' } },
  });

  /* ---- Derived data ---- */
  const nads = useMemo(
    () => (nadList as unknown as NetworkAttachmentDefinitionKind[]) || [],
    [nadList],
  );
  const namespaces = useMemo(
    () => (nsList as unknown as NamespaceKind[]) || [],
    [nsList],
  );
  const vmis = useMemo(
    () => (vmiList as unknown as VirtualMachineInstanceKind[]) || [],
    [vmiList],
  );
  const inventory = useMemo(
    () =>
      listDhcpServers(
        (depList || []) as unknown as Array<{
          metadata: { name: string; namespace?: string; labels?: Record<string, string> };
        }>,
        (cmList || []) as unknown as Array<{
          metadata: { name: string; namespace?: string; labels?: Record<string, string> };
          data?: Record<string, string>;
        }>,
        (podList || []) as unknown as Array<{
          metadata: { name: string; namespace?: string; labels?: Record<string, string> };
          status?: { phase?: string };
        }>,
      ),
    [depList, cmList, podList],
  );

  /* ---- Navigation ---- */
  const goNetworkHub = useCallback(() => {
    navigate('/community-tools/network');
  }, [navigate]);

  /* ---- Loading ---- */
  const ready = nadsLoaded && nsLoaded && depsLoaded && cmsLoaded && podsLoaded;

  if (!ready) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner size="xl" />
        </Bullseye>
      </PageSection>
    );
  }

  // suppress unused variable warning
  void MANAGED_BY_SELECTOR;
  void vmisLoaded;

  return (
    <>
      <DocumentTitle>{t('Network DHCP')}</DocumentTitle>

      <PageSection type="breadcrumb">
        <Breadcrumb>
          <BreadcrumbItem
            component="a"
            onClick={(e) => {
              e.preventDefault();
              goNetworkHub();
            }}
          >
            {t('Network')}
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{t('Network DHCP')}</BreadcrumbItem>
        </Breadcrumb>
      </PageSection>

      <ListPageHeader title={t('Network DHCP')} />

      <PageSection>
        <Stack hasGutter>
          <StackItem>
            <CommunityDisclaimer />
          </StackItem>

          <StackItem>
            <p className="netdhcp-lead">
              {t('Create and manage dnsmasq DHCP servers on NAD VLAN networks. Each server runs as a pod with a static IP on the target network, providing DHCP to connected clients.')}
            </p>
          </StackItem>

          <StackItem>
            <Tabs
              activeKey={activeTab}
              onSelect={(_e, key) => setActiveTab(key)}
              aria-label={t('DHCP tabs')}
            >
              <Tab
                eventKey={0}
                title={<TabTitleText>{t('Create DHCP Server')}</TabTitleText>}
              >
                <div style={{ paddingTop: 'var(--pf-t--global--spacer--md, 16px)' }}>
                  <CreateDhcpTab nads={nads} namespaces={namespaces} />
                </div>
              </Tab>
              <Tab
                eventKey={1}
                title={<TabTitleText>{t('Manage DHCP Servers')}</TabTitleText>}
              >
                <div style={{ paddingTop: 'var(--pf-t--global--spacer--md, 16px)' }}>
                  <ManageDhcpTab
                    inventory={inventory}
                    vmis={vmis}
                    rawConfigMaps={(cmList || []) as K8sResourceCommon[]}
                  />
                </div>
              </Tab>
            </Tabs>
          </StackItem>
        </Stack>
      </PageSection>
    </>
  );
};

export default NetworkDhcpPage;
