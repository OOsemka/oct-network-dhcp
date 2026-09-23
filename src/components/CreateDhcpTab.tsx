import {
  K8sResourceCommon,
  k8sCreate,
} from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  MenuToggle,
  NumberInput,
  Select,
  SelectList,
  SelectOption,
  Stack,
  StackItem,
  TextInput,
  Title,
} from '@patternfly/react-core';
import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { ConfigMapModel, DeploymentModel } from '../utils/k8s-resources';
import {
  DhcpServerConfig,
  NetworkAttachmentDefinitionKind,
  NamespaceKind,
  buildDhcpConfigMap,
  buildDhcpDeployment,
  cidrToNetmask,
  getK8sErrorMessage,
  isOvnNad,
  parseNadBridge,
  suggestGateway,
  suggestPool,
  suggestServerName,
} from '../utils/dhcp-server';
import { toYaml } from '../utils/yaml';
import dashboardLogger from '../utils/logger';

const LOG_ACTION = 'NETWORK_DHCP_CREATE';

type CreateDhcpTabProps = {
  nads: NetworkAttachmentDefinitionKind[];
  namespaces: NamespaceKind[];
};

const CreateDhcpTab: FC<CreateDhcpTabProps> = ({ nads, namespaces }) => {
  const { t } = useTranslation('plugin__oct-network-dhcp');

  /* ---- form state ---- */
  const [selectedNad, setSelectedNad] = useState('');
  const [nadSelectOpen, setNadSelectOpen] = useState(false);
  const [targetNamespace, setTargetNamespace] = useState('');
  const [nsSelectOpen, setNsSelectOpen] = useState(false);

  const [serverIp, setServerIp] = useState('');
  const [cidrPrefix, setCidrPrefix] = useState(24);
  const [poolStart, setPoolStart] = useState('');
  const [poolEnd, setPoolEnd] = useState('');
  const [leaseTime, setLeaseTime] = useState('12h');
  const [gateway, setGateway] = useState('');
  const [dnsServers, setDnsServers] = useState('8.8.8.8, 8.8.4.4');
  const [serverName, setServerName] = useState('');
  const [nameManual, setNameManual] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  /* ---- derived NAD data ---- */
  const nadOptions = useMemo(() => {
    return nads.map((nad) => {
      const info = parseNadBridge(nad);
      const ovn = isOvnNad(nad);
      const label = `${nad.metadata.namespace}/${nad.metadata.name}`;
      const desc = ovn
        ? 'OVN'
        : info.bridgeName
          ? `Bridge: ${info.bridgeName}${info.vlanId !== undefined ? `, VLAN ${info.vlanId}` : ''}`
          : info.type || '';
      return { key: label, nad, description: desc, isOvn: ovn };
    });
  }, [nads]);

  const selectedNadObj = useMemo(
    () => nadOptions.find((o) => o.key === selectedNad)?.nad,
    [nadOptions, selectedNad],
  );

  const namespaceNames = useMemo(
    () => (namespaces || []).map((ns) => ns.metadata.name).sort(),
    [namespaces],
  );

  /* ---- auto-suggest name ---- */
  useEffect(() => {
    if (!nameManual && selectedNadObj) {
      setServerName(suggestServerName(selectedNadObj.metadata.name));
    }
  }, [selectedNadObj, nameManual]);

  /* ---- auto-suggest from server IP ---- */
  useEffect(() => {
    if (serverIp) {
      const netmask = cidrToNetmask(cidrPrefix);
      const pool = suggestPool(serverIp, netmask);
      setPoolStart(pool.start);
      setPoolEnd(pool.end);
      setGateway(suggestGateway(serverIp));
    }
  }, [serverIp, cidrPrefix]);

  /* ---- auto-set target namespace from NAD ---- */
  useEffect(() => {
    if (selectedNadObj && !targetNamespace) {
      setTargetNamespace(selectedNadObj.metadata.namespace);
    }
  }, [selectedNadObj, targetNamespace]);

  /* ---- validation ---- */
  const canCreate = useMemo(() => {
    if (!selectedNad) return false;
    if (!targetNamespace) return false;
    if (!serverIp) return false;
    if (!serverName.trim()) return false;
    if (!poolStart || !poolEnd) return false;
    return true;
  }, [selectedNad, targetNamespace, serverIp, serverName, poolStart, poolEnd]);

  /* ---- build config ---- */
  const buildConfig = useCallback((): DhcpServerConfig => {
    return {
      serverIp,
      netmask: cidrToNetmask(cidrPrefix),
      poolStart,
      poolEnd,
      leaseTime: leaseTime || '12h',
      gateway,
      dnsServers: dnsServers.split(',').map((s) => s.trim()).filter(Boolean),
      reservations: [],
    };
  }, [serverIp, cidrPrefix, poolStart, poolEnd, leaseTime, gateway, dnsServers]);

  /* ---- preview ---- */
  const previewContent = useMemo(() => {
    if (!canCreate || !selectedNadObj) return '';
    const config = buildConfig();
    const cm = buildDhcpConfigMap({
      name: serverName.trim(),
      namespace: targetNamespace,
      nadName: selectedNadObj.metadata.name,
      nadNamespace: selectedNadObj.metadata.namespace,
      config,
    });
    const dep = buildDhcpDeployment({
      name: serverName.trim(),
      namespace: targetNamespace,
      nadName: selectedNadObj.metadata.name,
      nadNamespace: selectedNadObj.metadata.namespace,
      serverIp,
      netmask: cidrToNetmask(cidrPrefix),
      configMapName: serverName.trim(),
    });
    return (
      toYaml(cm as Record<string, unknown>) +
      '---\n' +
      toYaml(dep as Record<string, unknown>)
    );
  }, [canCreate, selectedNadObj, buildConfig, serverName, targetNamespace, serverIp, cidrPrefix]);

  /* ---- create handler ---- */
  const handleCreate = useCallback(async () => {
    if (!canCreate || !selectedNadObj) return;
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const config = buildConfig();
      const cmData = buildDhcpConfigMap({
        name: serverName.trim(),
        namespace: targetNamespace,
        nadName: selectedNadObj.metadata.name,
        nadNamespace: selectedNadObj.metadata.namespace,
        config,
      });
      const depData = buildDhcpDeployment({
        name: serverName.trim(),
        namespace: targetNamespace,
        nadName: selectedNadObj.metadata.name,
        nadNamespace: selectedNadObj.metadata.namespace,
        serverIp,
        netmask: cidrToNetmask(cidrPrefix),
        configMapName: serverName.trim(),
      });

      dashboardLogger.info(LOG_ACTION, 'Creating ConfigMap', `${targetNamespace}/${serverName.trim()}`);
      await k8sCreate({
        model: ConfigMapModel,
        data: cmData as unknown as K8sResourceCommon,
        ns: targetNamespace,
      });

      dashboardLogger.info(LOG_ACTION, 'Creating Deployment', `${targetNamespace}/${serverName.trim()}`);
      await k8sCreate({
        model: DeploymentModel,
        data: depData as unknown as K8sResourceCommon,
        ns: targetNamespace,
      });

      dashboardLogger.info(LOG_ACTION, 'Create succeeded', serverName.trim());
      setCreateSuccess(
        t('DHCP server {{name}} created in {{namespace}}', {
          name: serverName.trim(),
          namespace: targetNamespace,
        }),
      );
    } catch (err) {
      const msg = getK8sErrorMessage(err);
      dashboardLogger.error(LOG_ACTION, 'Create failed', msg);
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }, [canCreate, selectedNadObj, buildConfig, serverName, targetNamespace, serverIp, cidrPrefix, t]);

  /* ---- create another ---- */
  const handleCreateAnother = useCallback(() => {
    setCreateSuccess(null);
    setCreateError(null);
    setSelectedNad('');
    setTargetNamespace('');
    setServerIp('');
    setPoolStart('');
    setPoolEnd('');
    setGateway('');
    setServerName('');
    setNameManual(false);
  }, []);

  return (
    <Stack hasGutter>
      {/* NAD Selection Card */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('NAD Selection')}</Title>
          </CardTitle>
          <CardBody>
            <Form>
              <FormGroup label={t('Network Attachment Definition')} fieldId="netdhcp-nad" isRequired>
                <Select
                  id="netdhcp-nad"
                  isOpen={nadSelectOpen}
                  onOpenChange={setNadSelectOpen}
                  onSelect={(_e, value) => {
                    setSelectedNad(value as string);
                    setNadSelectOpen(false);
                    setNameManual(false);
                  }}
                  selected={selectedNad}
                  toggle={(toggleRef) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setNadSelectOpen(!nadSelectOpen)}
                      isExpanded={nadSelectOpen}
                      style={{ width: '100%' }}
                    >
                      {selectedNad || t('Select a NAD')}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    {nadOptions.map((opt) => (
                      <SelectOption
                        key={opt.key}
                        value={opt.key}
                        description={opt.description}
                      >
                        {opt.key}
                      </SelectOption>
                    ))}
                    {nadOptions.length === 0 && (
                      <SelectOption isDisabled value="">
                        {t('No NADs found')}
                      </SelectOption>
                    )}
                  </SelectList>
                </Select>
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      {t('Select the NAD network where the DHCP server will operate.')}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>

              <FormGroup label={t('Target Namespace')} fieldId="netdhcp-namespace" isRequired>
                <Select
                  id="netdhcp-namespace"
                  isOpen={nsSelectOpen}
                  onOpenChange={setNsSelectOpen}
                  onSelect={(_e, value) => {
                    setTargetNamespace(value as string);
                    setNsSelectOpen(false);
                  }}
                  selected={targetNamespace}
                  toggle={(toggleRef) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setNsSelectOpen(!nsSelectOpen)}
                      isExpanded={nsSelectOpen}
                      style={{ width: '100%' }}
                    >
                      {targetNamespace || t('Select a namespace')}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    {namespaceNames.map((ns) => (
                      <SelectOption key={ns} value={ns}>
                        {ns}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
              </FormGroup>
            </Form>
          </CardBody>
        </Card>
      </StackItem>

      {/* IP Configuration Card */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('IP Configuration')}</Title>
          </CardTitle>
          <CardBody>
            <Form>
              <div className="netdhcp-inline-fields">
                <FormGroup label={t('Server IP')} fieldId="netdhcp-server-ip" isRequired>
                  <TextInput
                    id="netdhcp-server-ip"
                    value={serverIp}
                    onChange={(_e, value) => setServerIp(value)}
                    placeholder="10.211.0.1"
                  />
                </FormGroup>
                <FormGroup label={t('CIDR Prefix')} fieldId="netdhcp-cidr">
                  <NumberInput
                    id="netdhcp-cidr"
                    value={cidrPrefix}
                    min={1}
                    max={32}
                    onChange={(e) => {
                      const val = parseInt((e.target as HTMLInputElement).value, 10);
                      setCidrPrefix(isNaN(val) ? 24 : val);
                    }}
                    onMinus={() => setCidrPrefix(Math.max(1, cidrPrefix - 1))}
                    onPlus={() => setCidrPrefix(Math.min(32, cidrPrefix + 1))}
                    widthChars={4}
                  />
                </FormGroup>
              </div>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {t('The static IP the dnsmasq pod will receive on the NAD network.')}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </Form>
          </CardBody>
        </Card>
      </StackItem>

      {/* DHCP Pool Card */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('DHCP Pool')}</Title>
          </CardTitle>
          <CardBody>
            <Form>
              <div className="netdhcp-inline-fields">
                <FormGroup label={t('Pool Start')} fieldId="netdhcp-pool-start" isRequired>
                  <TextInput
                    id="netdhcp-pool-start"
                    value={poolStart}
                    onChange={(_e, value) => setPoolStart(value)}
                    placeholder="10.211.0.10"
                  />
                </FormGroup>
                <FormGroup label={t('Pool End')} fieldId="netdhcp-pool-end" isRequired>
                  <TextInput
                    id="netdhcp-pool-end"
                    value={poolEnd}
                    onChange={(_e, value) => setPoolEnd(value)}
                    placeholder="10.211.0.254"
                  />
                </FormGroup>
                <FormGroup label={t('Lease Time')} fieldId="netdhcp-lease">
                  <TextInput
                    id="netdhcp-lease"
                    value={leaseTime}
                    onChange={(_e, value) => setLeaseTime(value)}
                    placeholder="12h"
                  />
                </FormGroup>
              </div>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {t('Auto-suggested from server IP subnet. Lease time examples: 12h, 1d, infinite.')}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </Form>
          </CardBody>
        </Card>
      </StackItem>

      {/* Gateway + DNS Card */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('Gateway & DNS')}</Title>
          </CardTitle>
          <CardBody>
            <Form>
              <FormGroup label={t('Gateway')} fieldId="netdhcp-gateway">
                <TextInput
                  id="netdhcp-gateway"
                  value={gateway}
                  onChange={(_e, value) => setGateway(value)}
                  placeholder="10.211.0.1"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>{t('Default gateway for DHCP clients.')}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup label={t('DNS Servers')} fieldId="netdhcp-dns">
                <TextInput
                  id="netdhcp-dns"
                  value={dnsServers}
                  onChange={(_e, value) => setDnsServers(value)}
                  placeholder="8.8.8.8, 8.8.4.4"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>{t('Comma-separated DNS server IPs.')}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </Form>
          </CardBody>
        </Card>
      </StackItem>

      {/* Server Name Card */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('Server Name')}</Title>
          </CardTitle>
          <CardBody>
            <Form>
              <FormGroup label={t('Server Name')} fieldId="netdhcp-name" isRequired>
                <TextInput
                  id="netdhcp-name"
                  value={serverName}
                  onChange={(_e, value) => {
                    setServerName(value);
                    setNameManual(true);
                  }}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      {t('Auto-suggested from NAD name. Editable. Used for both the ConfigMap and Deployment.')}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </Form>
          </CardBody>
        </Card>
      </StackItem>

      {/* Review + Create Card */}
      <StackItem>
        <Card>
          <CardTitle>
            <Title headingLevel="h3">{t('Review & Create')}</Title>
          </CardTitle>
          <CardBody>
            <Stack hasGutter>
              <StackItem>
                <DescriptionList isHorizontal columnModifier={{ default: '2Col' }}>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('NAD')}</DescriptionListTerm>
                    <DescriptionListDescription>{selectedNad || '—'}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Target Namespace')}</DescriptionListTerm>
                    <DescriptionListDescription>{targetNamespace || '—'}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Server IP')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {serverIp ? `${serverIp}/${cidrPrefix}` : '—'}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('DHCP Pool')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {poolStart && poolEnd ? `${poolStart} – ${poolEnd}` : '—'}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Gateway')}</DescriptionListTerm>
                    <DescriptionListDescription>{gateway || '—'}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('DNS Servers')}</DescriptionListTerm>
                    <DescriptionListDescription>{dnsServers || '—'}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Server Name')}</DescriptionListTerm>
                    <DescriptionListDescription>{serverName || '—'}</DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </StackItem>

              {previewContent && (
                <StackItem>
                  <Title headingLevel="h4">{t('YAML Preview')}</Title>
                  <div className="netdhcp-review-yaml">
                    <CodeBlock>
                      <CodeBlockCode>{previewContent}</CodeBlockCode>
                    </CodeBlock>
                  </div>
                </StackItem>
              )}

              <StackItem>
                <Alert
                  variant="warning"
                  isInline
                  title={t('NET_RAW capability')}
                >
                  {t('The DHCP server deployment requires NET_RAW capability for dnsmasq raw sockets. Ensure your cluster security policy allows this.')}
                </Alert>
              </StackItem>

              {createError && (
                <StackItem>
                  <Alert variant="danger" title={t('Failed to create DHCP server')} isInline>
                    {createError}
                  </Alert>
                </StackItem>
              )}

              {createSuccess && (
                <StackItem>
                  <Alert variant="success" title={t('DHCP server created')} isInline>
                    {createSuccess}
                  </Alert>
                </StackItem>
              )}

              <StackItem>
                <div className="netdhcp-actions">
                  <ActionGroup>
                    <Button
                      variant="primary"
                      onClick={handleCreate}
                      isDisabled={creating || !canCreate || Boolean(createSuccess)}
                      isLoading={creating}
                    >
                      {creating ? t('Creating...') : t('Create')}
                    </Button>
                    {createSuccess && (
                      <Button variant="secondary" onClick={handleCreateAnother}>
                        {t('Create another')}
                      </Button>
                    )}
                  </ActionGroup>
                </div>
              </StackItem>
            </Stack>
          </CardBody>
        </Card>
      </StackItem>
    </Stack>
  );
};

export default CreateDhcpTab;
