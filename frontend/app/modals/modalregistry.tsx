// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazyWithRetry } from "@/app/element/lazy-module";
import { MessageModal } from "@/app/modals/messagemodal";
import { NewInstallOnboardingModal } from "@/app/onboarding/onboarding";
import { UpgradeOnboardingModal } from "@/app/onboarding/onboarding-upgrade";
import { UpgradeOnboardingPatch } from "@/app/onboarding/onboarding-upgrade-patch";
import { AboutModal } from "./about";
import { UserInputModal } from "./userinputmodal";

const PublishAppModal = lazyWithRetry(
    () => import("@/builder/builder-apppanel").then((module) => ({ default: module.PublishAppModal })),
    "Publish App"
);
const RenameFileModal = lazyWithRetry(
    () => import("@/builder/tabs/builder-filestab").then((module) => ({ default: module.RenameFileModal })),
    "Rename File"
);
const DeleteFileModal = lazyWithRetry(
    () => import("@/builder/tabs/builder-filestab").then((module) => ({ default: module.DeleteFileModal })),
    "Delete File"
);
const SetSecretDialog = lazyWithRetry(
    () => import("@/builder/tabs/builder-secrettab").then((module) => ({ default: module.SetSecretDialog })),
    "Set Secret"
);

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [NewInstallOnboardingModal.displayName || "NewInstallOnboardingModal"]: NewInstallOnboardingModal,
    [UpgradeOnboardingModal.displayName || "UpgradeOnboardingModal"]: UpgradeOnboardingModal,
    [UpgradeOnboardingPatch.displayName || "UpgradeOnboardingPatch"]: UpgradeOnboardingPatch,
    [UserInputModal.displayName || "UserInputModal"]: UserInputModal,
    [AboutModal.displayName || "AboutModal"]: AboutModal,
    [MessageModal.displayName || "MessageModal"]: MessageModal,
    PublishAppModal,
    RenameFileModal,
    DeleteFileModal,
    SetSecretDialog,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
