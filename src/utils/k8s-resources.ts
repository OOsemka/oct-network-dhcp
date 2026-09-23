import { K8sModel } from '@openshift-console/dynamic-plugin-sdk';

/** Namespaced Multus network attachment. */
export const NetworkAttachmentDefinitionModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'k8s.cni.cncf.io',
  kind: 'NetworkAttachmentDefinition',
  abbr: 'NAD',
  label: 'NetworkAttachmentDefinition',
  labelPlural: 'NetworkAttachmentDefinitions',
  plural: 'network-attachment-definitions',
  namespaced: true,
};

/** Core v1 Namespace. */
export const NamespaceModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Namespace',
  abbr: 'NS',
  label: 'Namespace',
  labelPlural: 'Namespaces',
  plural: 'namespaces',
  namespaced: false,
};

/** Apps v1 Deployment. */
export const DeploymentModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'apps',
  kind: 'Deployment',
  abbr: 'D',
  label: 'Deployment',
  labelPlural: 'Deployments',
  plural: 'deployments',
  namespaced: true,
};

/** Core v1 ConfigMap. */
export const ConfigMapModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  abbr: 'CM',
  label: 'ConfigMap',
  labelPlural: 'ConfigMaps',
  plural: 'configmaps',
  namespaced: true,
};

/** KubeVirt v1 VirtualMachineInstance. */
export const VirtualMachineInstanceModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'kubevirt.io',
  kind: 'VirtualMachineInstance',
  abbr: 'VMI',
  label: 'VirtualMachineInstance',
  labelPlural: 'VirtualMachineInstances',
  plural: 'virtualmachineinstances',
  namespaced: true,
};

/** Core v1 Pod. */
export const PodModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Pod',
  abbr: 'P',
  label: 'Pod',
  labelPlural: 'Pods',
  plural: 'pods',
  namespaced: true,
};

/** Core v1 ServiceAccount. */
export const ServiceAccountModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'ServiceAccount',
  abbr: 'SA',
  label: 'ServiceAccount',
  labelPlural: 'ServiceAccounts',
  plural: 'serviceaccounts',
  namespaced: true,
};

/** RBAC v1 ClusterRole. */
export const ClusterRoleModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'rbac.authorization.k8s.io',
  kind: 'ClusterRole',
  abbr: 'CR',
  label: 'ClusterRole',
  labelPlural: 'ClusterRoles',
  plural: 'clusterroles',
  namespaced: false,
};

/** RBAC v1 ClusterRoleBinding. */
export const ClusterRoleBindingModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'rbac.authorization.k8s.io',
  kind: 'ClusterRoleBinding',
  abbr: 'CRB',
  label: 'ClusterRoleBinding',
  labelPlural: 'ClusterRoleBindings',
  plural: 'clusterrolebindings',
  namespaced: false,
};

/** security.openshift.io v1 SecurityContextConstraints. */
export const SecurityContextConstraintsModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'security.openshift.io',
  kind: 'SecurityContextConstraints',
  abbr: 'SCC',
  label: 'SecurityContextConstraints',
  labelPlural: 'SecurityContextConstraints',
  plural: 'securitycontextconstraints',
  namespaced: false,
};
