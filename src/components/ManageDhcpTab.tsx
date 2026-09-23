import {
  K8sResourceCommon,
  k8sDelete,
  k8sPatch,
  k8sUpdate,
} from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Stack,
  StackItem,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { NetworkIcon, TrashIcon } from '@patternfly/react-icons';
import React, { FC, useCallback, useMemo, useState } from 'react';

import { ConfigMapModel, DeploymentModel, ClusterRoleBindingModel } from '../utils/k8s-resources';
import {
  DhcpReservation,
  DhcpServerConfig,
  DhcpServerInventoryItem,
  VirtualMachineInstanceKind,
  dhcpClusterRoleBindingName,
  discoverVmsOnNad,
  generateDnsmasqConf,
  getK8sErrorMessage,
} from '../utils/dhcp-server';
import dashboardLogger from '../utils/logger';

const LOG_ACTION = 'NETWORK_DHCP_MANAGE';

type ManageDhcpTabProps = {
  inventory: DhcpServerInventoryItem[];
  vmis: VirtualMachineInstanceKind[];
  rawConfigMaps: K8sResourceCommon[];
};

const ManageDhcpTab: FC<ManageDhcpTabProps> = ({ inventory, vmis, rawConfigMaps }) => {
  const { t } = useTranslation('plugin__oct-network-dhcp');

  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [editPoolStart, setEditPoolStart] = useState('');
  const [editPoolEnd, setEditPoolEnd] = useState('');
  const [editGateway, setEditGateway] = useState('');
  const [editDns, setEditDns] = useState('');
  const [editLeaseTime, setEditLeaseTime] = useState('');
  const [editReservations, setEditReservations] = useState<DhcpReservation[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DhcpServerInventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [addVmOpen, setAddVmOpen] = useState(false);
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [manualMac, setManualMac] = useState('');
  const [manualIp, setManualIp] = useState('');
  const [manualHostname, setManualHostname] = useState('');

  const selected = useMemo(
    () => inventory.find((s) => s.name === selectedServer && s.namespace === selectedServer?.split('/')[0]) ||
          inventory.find((s) => s.name === selectedServer),
    [inventory, selectedServer],
  );

  const selectServer = useCallback(
    (item: DhcpServerInventoryItem) => {
      setSelectedServer(item.name);
      setSaveError(null);
      setSaveSuccess(null);
      if (item.config) {
        setEditPoolStart(item.config.poolStart);
        setEditPoolEnd(item.config.poolEnd);
        setEditGateway(item.config.gateway);
        setEditDns(item.config.dnsServers.join(', '));
        setEditLeaseTime(item.config.leaseTime);
        setEditReservations([...item.config.reservations]);
      }
    },
    [],
  );

  const vmCandidates = useMemo(() => {
    if (!selected) return [];
    return discoverVmsOnNad(vmis, selected.nadName, selected.nadNamespace);
  }, [selected, vmis]);

  /* ---- save settings ---- */
  const handleSaveSettings = useCallback(async () => {
    if (!selected || !selected.config) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const updatedConfig: DhcpServerConfig = {
        ...selected.config,
        poolStart: editPoolStart,
        poolEnd: editPoolEnd,
        gateway: editGateway,
        dnsServers: editDns.split(',').map((s) => s.trim()).filter(Boolean),
        leaseTime: editLeaseTime || '12h',
        reservations: editReservations,
      };

      const rawCm = rawConfigMaps.find(
        (cm) =>
          (cm as { metadata: { name: string; namespace?: string } }).metadata.name === selected.configMapName &&
          (cm as { metadata: { name: string; namespace?: string } }).metadata.namespace === selected.namespace,
      );
      if (!rawCm) throw new Error(t('ConfigMap not found'));

      const updatedCm = {
        ...rawCm,
        data: {
          ...(rawCm as { data?: Record<string, string> }).data,
          'dnsmasq.conf': generateDnsmasqConf(updatedConfig),
        },
      };

      dashboardLogger.info(LOG_ACTION, 'Saving settings', `${selected.namespace}/${selected.configMapName}`);
      await k8sUpdate({
        model: ConfigMapModel,
        data: updatedCm as K8sResourceCommon,
        ns: selected.namespace,
      });

      dashboardLogger.info(LOG_ACTION, 'Restarting deployment', selected.deploymentName);
      await k8sPatch({
        model: DeploymentModel,
        resource: {
          metadata: {
            name: selected.deploymentName,
            namespace: selected.namespace,
          },
        } as K8sResourceCommon,
        data: [
          {
            op: 'add',
            path: '/spec/template/metadata/annotations/oct-dhcp~1restart-trigger',
            value: new Date().toISOString(),
          },
        ],
      });

      setSaveSuccess(t('Settings saved. Pod will restart with new configuration.'));
      dashboardLogger.info(LOG_ACTION, 'Save succeeded', selected.name);
    } catch (err) {
      const msg = getK8sErrorMessage(err);
      dashboardLogger.error(LOG_ACTION, 'Save failed', msg);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [selected, editPoolStart, editPoolEnd, editGateway, editDns, editLeaseTime, editReservations, rawConfigMaps, t]);

  /* ---- delete server ---- */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      dashboardLogger.info(LOG_ACTION, 'Deleting Deployment', `${deleteTarget.namespace}/${deleteTarget.deploymentName}`);
      await k8sDelete({
        model: DeploymentModel,
        resource: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: deleteTarget.deploymentName, namespace: deleteTarget.namespace },
        },
      });

      dashboardLogger.info(LOG_ACTION, 'Deleting ConfigMap', `${deleteTarget.namespace}/${deleteTarget.configMapName}`);
      await k8sDelete({
        model: ConfigMapModel,
        resource: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: deleteTarget.configMapName, namespace: deleteTarget.namespace },
        },
      });

      const crbName = dhcpClusterRoleBindingName(deleteTarget.name, deleteTarget.namespace);
      dashboardLogger.info(LOG_ACTION, 'Deleting ClusterRoleBinding', crbName);
      try {
        await k8sDelete({
          model: ClusterRoleBindingModel,
          resource: {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'ClusterRoleBinding',
            metadata: { name: crbName },
          },
        });
      } catch (crbErr) {
        const crbMsg = getK8sErrorMessage(crbErr);
        if (!crbMsg.includes('not found') && !crbMsg.includes('404')) {
          throw crbErr;
        }
        dashboardLogger.info(LOG_ACTION, 'ClusterRoleBinding already absent', crbName);
      }

      dashboardLogger.info(LOG_ACTION, 'Delete succeeded', deleteTarget.name);
      if (selectedServer === deleteTarget.name) {
        setSelectedServer(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      const msg = getK8sErrorMessage(err);
      dashboardLogger.error(LOG_ACTION, 'Delete failed', msg);
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, selectedServer]);

  /* ---- reservation helpers ---- */
  const removeReservation = useCallback((idx: number) => {
    setEditReservations((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addReservationFromVm = useCallback(
    (vm: { vmName: string; mac: string; ip?: string }) => {
      setEditReservations((prev) => [
        ...prev,
        {
          mac: vm.mac,
          ip: vm.ip || '',
          hostname: vm.vmName,
          source: 'vm' as const,
        },
      ]);
      setAddVmOpen(false);
    },
    [],
  );

  const addManualReservation = useCallback(() => {
    if (!manualMac || !manualIp) return;
    setEditReservations((prev) => [
      ...prev,
      {
        mac: manualMac,
        ip: manualIp,
        hostname: manualHostname || undefined,
        source: 'manual' as const,
      },
    ]);
    setManualMac('');
    setManualIp('');
    setManualHostname('');
    setAddManualOpen(false);
  }, [manualMac, manualIp, manualHostname]);

  return (
    <Stack hasGutter>
      {/* Server List */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('DHCP Servers')}</Title>
          </CardTitle>
          <CardBody>
            {inventory.length === 0 ? (
              <EmptyState
                titleText={t('No DHCP servers found')}
                icon={NetworkIcon}
                headingLevel="h4"
              >
                <EmptyStateBody>
                  {t('No DHCP servers managed by this tool were found. Create one in the Create tab.')}
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <div className="netdhcp-table-wrap">
                <Table aria-label={t('DHCP Servers')} variant="compact">
                  <Thead>
                    <Tr>
                      <Th>{t('Name')}</Th>
                      <Th>{t('Namespace')}</Th>
                      <Th>{t('NAD')}</Th>
                      <Th>{t('Pool')}</Th>
                      <Th>{t('Gateway')}</Th>
                      <Th>{t('Status')}</Th>
                      <Th>{t('Reservations')}</Th>
                      <Th screenReaderText={t('Actions')} />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {inventory.map((item) => (
                      <Tr
                        key={`${item.namespace}/${item.name}`}
                        isSelectable
                        isClickable
                        isRowSelected={selectedServer === item.name}
                        onRowClick={() => selectServer(item)}
                      >
                        <Td dataLabel={t('Name')}>{item.name}</Td>
                        <Td dataLabel={t('Namespace')}>{item.namespace}</Td>
                        <Td dataLabel={t('NAD')}>
                          {item.nadNamespace}/{item.nadName}
                        </Td>
                        <Td dataLabel={t('Pool')}>
                          {item.config
                            ? `${item.config.poolStart} – ${item.config.poolEnd}`
                            : '—'}
                        </Td>
                        <Td dataLabel={t('Gateway')}>
                          {item.config?.gateway || '—'}
                        </Td>
                        <Td dataLabel={t('Status')}>{item.podStatus}</Td>
                        <Td dataLabel={t('Reservations')}>
                          {item.config ? String(item.config.reservations.length) : '0'}
                        </Td>
                        <Td isActionCell>
                          <Button
                            variant="plain"
                            aria-label={t('Delete {{name}}', { name: item.name })}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(item);
                            }}
                            icon={<TrashIcon />}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      </StackItem>

      {/* Detail Panel */}
      {selected && selected.config && (
        <StackItem>
          <div className="netdhcp-detail-panel">
            {/* Settings Card */}
            <Stack hasGutter>
              <StackItem>
                <Card>
                  <CardTitle>
                    <Title headingLevel="h3">
                      {t('Settings — {{name}}', { name: selected.name })}
                    </Title>
                  </CardTitle>
                  <CardBody>
                    <Form>
                      <div className="netdhcp-inline-fields">
                        <FormGroup label={t('Pool Start')} fieldId="netdhcp-edit-pool-start">
                          <TextInput
                            id="netdhcp-edit-pool-start"
                            value={editPoolStart}
                            onChange={(_e, v) => setEditPoolStart(v)}
                          />
                        </FormGroup>
                        <FormGroup label={t('Pool End')} fieldId="netdhcp-edit-pool-end">
                          <TextInput
                            id="netdhcp-edit-pool-end"
                            value={editPoolEnd}
                            onChange={(_e, v) => setEditPoolEnd(v)}
                          />
                        </FormGroup>
                      </div>
                      <FormGroup label={t('Gateway')} fieldId="netdhcp-edit-gateway">
                        <TextInput
                          id="netdhcp-edit-gateway"
                          value={editGateway}
                          onChange={(_e, v) => setEditGateway(v)}
                        />
                      </FormGroup>
                      <FormGroup label={t('DNS Servers')} fieldId="netdhcp-edit-dns">
                        <TextInput
                          id="netdhcp-edit-dns"
                          value={editDns}
                          onChange={(_e, v) => setEditDns(v)}
                        />
                      </FormGroup>
                      <FormGroup label={t('Lease Time')} fieldId="netdhcp-edit-lease">
                        <TextInput
                          id="netdhcp-edit-lease"
                          value={editLeaseTime}
                          onChange={(_e, v) => setEditLeaseTime(v)}
                        />
                      </FormGroup>
                    </Form>
                  </CardBody>
                </Card>
              </StackItem>

              {/* Reservations Card */}
              <StackItem>
                <Card>
                  <CardTitle>
                    <Title headingLevel="h3">{t('Reservations')}</Title>
                  </CardTitle>
                  <CardBody>
                    <Stack hasGutter>
                      <StackItem>
                        {editReservations.length === 0 ? (
                          <p className="netdhcp-lead">{t('No reservations configured.')}</p>
                        ) : (
                          <Table aria-label={t('Reservations')} variant="compact">
                            <Thead>
                              <Tr>
                                <Th>{t('MAC')}</Th>
                                <Th>{t('IP')}</Th>
                                <Th>{t('Hostname')}</Th>
                                <Th>{t('Source')}</Th>
                                <Th screenReaderText={t('Actions')} />
                              </Tr>
                            </Thead>
                            <Tbody>
                              {editReservations.map((res, idx) => (
                                <Tr key={`${res.mac}-${idx}`}>
                                  <Td dataLabel={t('MAC')}>{res.mac}</Td>
                                  <Td dataLabel={t('IP')}>{res.ip}</Td>
                                  <Td dataLabel={t('Hostname')}>{res.hostname || '—'}</Td>
                                  <Td dataLabel={t('Source')}>{res.source || 'manual'}</Td>
                                  <Td isActionCell>
                                    <Button
                                      variant="plain"
                                      aria-label={t('Remove')}
                                      onClick={() => removeReservation(idx)}
                                      icon={<TrashIcon />}
                                    />
                                  </Td>
                                </Tr>
                              ))}
                            </Tbody>
                          </Table>
                        )}
                      </StackItem>
                      <StackItem>
                        <ActionGroup>
                          <Button variant="secondary" onClick={() => setAddVmOpen(true)}>
                            {t('Add from VM')}
                          </Button>
                          <Button variant="secondary" onClick={() => setAddManualOpen(true)}>
                            {t('Add Manual')}
                          </Button>
                        </ActionGroup>
                      </StackItem>
                    </Stack>
                  </CardBody>
                </Card>
              </StackItem>

              {/* Save / Error / Success */}
              <StackItem>
                {saveError && (
                  <Alert variant="danger" title={t('Failed to save')} isInline>
                    {saveError}
                  </Alert>
                )}
                {saveSuccess && (
                  <Alert variant="success" title={t('Saved')} isInline>
                    {saveSuccess}
                  </Alert>
                )}
                <div className="netdhcp-actions">
                  <ActionGroup>
                    <Button
                      variant="primary"
                      onClick={handleSaveSettings}
                      isDisabled={saving}
                      isLoading={saving}
                    >
                      {saving ? t('Saving...') : t('Save')}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setDeleteTarget(selected)}
                    >
                      {t('Delete Server')}
                    </Button>
                  </ActionGroup>
                </div>
              </StackItem>
            </Stack>
          </div>
        </StackItem>
      )}

      {/* Add from VM Modal */}
      <Modal
        isOpen={addVmOpen}
        onClose={() => setAddVmOpen(false)}
        variant="medium"
        aria-labelledby="netdhcp-add-vm-title"
      >
        <ModalHeader title={t('Add Reservation from VM')} labelId="netdhcp-add-vm-title" />
        <ModalBody>
          {vmCandidates.length === 0 ? (
            <EmptyState titleText={t('No VMs found on this NAD')} icon={NetworkIcon} headingLevel="h4">
              <EmptyStateBody>
                {t('No VirtualMachineInstances with interfaces on this NAD were found.')}
              </EmptyStateBody>
            </EmptyState>
          ) : (
            <Table aria-label={t('VM candidates')} variant="compact">
              <Thead>
                <Tr>
                  <Th>{t('VM Name')}</Th>
                  <Th>{t('Namespace')}</Th>
                  <Th>{t('MAC')}</Th>
                  <Th>{t('Current IP')}</Th>
                  <Th screenReaderText={t('Actions')} />
                </Tr>
              </Thead>
              <Tbody>
                {vmCandidates.map((vm) => (
                  <Tr key={`${vm.vmNamespace}/${vm.vmName}/${vm.mac}`}>
                    <Td dataLabel={t('VM Name')}>{vm.vmName}</Td>
                    <Td dataLabel={t('Namespace')}>{vm.vmNamespace}</Td>
                    <Td dataLabel={t('MAC')}>{vm.mac}</Td>
                    <Td dataLabel={t('Current IP')}>{vm.ip || '—'}</Td>
                    <Td isActionCell>
                      <Button
                        variant="primary"
                        isSmall
                        onClick={() => addReservationFromVm(vm)}
                      >
                        {t('Add')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="link" onClick={() => setAddVmOpen(false)}>
            {t('Cancel')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Add Manual Modal */}
      <Modal
        isOpen={addManualOpen}
        onClose={() => setAddManualOpen(false)}
        variant="small"
        aria-labelledby="netdhcp-add-manual-title"
      >
        <ModalHeader title={t('Add Manual Reservation')} labelId="netdhcp-add-manual-title" />
        <ModalBody>
          <Form>
            <FormGroup label={t('MAC Address')} fieldId="netdhcp-manual-mac" isRequired>
              <TextInput
                id="netdhcp-manual-mac"
                value={manualMac}
                onChange={(_e, v) => setManualMac(v)}
                placeholder="aa:bb:cc:dd:ee:ff"
              />
            </FormGroup>
            <FormGroup label={t('IP Address')} fieldId="netdhcp-manual-ip" isRequired>
              <TextInput
                id="netdhcp-manual-ip"
                value={manualIp}
                onChange={(_e, v) => setManualIp(v)}
                placeholder="10.211.0.50"
              />
            </FormGroup>
            <FormGroup label={t('Hostname')} fieldId="netdhcp-manual-hostname">
              <TextInput
                id="netdhcp-manual-hostname"
                value={manualHostname}
                onChange={(_e, v) => setManualHostname(v)}
                placeholder="my-host"
              />
            </FormGroup>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={addManualReservation}
            isDisabled={!manualMac || !manualIp}
          >
            {t('Add')}
          </Button>
          <Button variant="link" onClick={() => setAddManualOpen(false)}>
            {t('Cancel')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Server Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null); } }}
        variant="small"
        aria-labelledby="netdhcp-delete-title"
      >
        <ModalHeader
          title={t('Delete DHCP Server')}
          labelId="netdhcp-delete-title"
          titleIconVariant="warning"
        />
        <ModalBody>
          {deleteTarget && (
            <Stack hasGutter>
              <StackItem>
                {t('Delete DHCP server {{name}} in {{namespace}}? This will remove the Deployment, ConfigMap, and the anyuid SCC ClusterRoleBinding.', {
                  name: deleteTarget.name,
                  namespace: deleteTarget.namespace,
                })}
              </StackItem>
              {deleteError && (
                <StackItem>
                  <Alert variant="danger" title={t('Failed to delete')} isInline>
                    {deleteError}
                  </Alert>
                </StackItem>
              )}
            </Stack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={handleDelete}
            isDisabled={deleting}
            isLoading={deleting}
          >
            {deleting ? t('Deleting...') : t('Delete')}
          </Button>
          <Button
            variant="link"
            onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
            isDisabled={deleting}
          >
            {t('Cancel')}
          </Button>
        </ModalFooter>
      </Modal>
    </Stack>
  );
};

export default ManageDhcpTab;
