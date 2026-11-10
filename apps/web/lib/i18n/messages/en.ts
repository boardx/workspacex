import { aiCatalogAdminEn } from "../namespaces/ai-catalog-admin";
import { orgOverviewRedesignEn } from "../namespaces/org-overview-redesign";
import { orgPeopleRedesignEn } from "../namespaces/org-people-redesign";
import { orgControlsRedesignEn } from "../namespaces/org-controls-redesign";
import { workshopLiveEn } from "../namespaces/workshop-live";
import { platformOpsStatusEn } from "../namespaces/platform-ops-status";
import { modelTestbenchEn } from "../namespaces/model-testbench";
import { platformModelCatalogEn } from "../namespaces/platform-model-catalog";
import { telemetrySettingsEn } from "../namespaces/telemetry-settings";
import { platformMembersEn } from "../namespaces/platform-members";
import { surveyTemplatesEn } from "../namespaces/survey-templates";
import { surveyResultsEn } from "../namespaces/survey-results";
import { surveyPublicEn } from "../namespaces/survey-public";
import { surveyWorkspaceEn } from "../namespaces/survey-workspace";
import { surveyRuntimeErrorsEn } from "../namespaces/survey-runtime-errors";
import { surveyDesignEn } from "../namespaces/survey-design";
import { surveyLibraryEn } from "../namespaces/survey-library";
import { aiUsageEn } from "../namespaces/ai-usage";
import { adminLimitPolicyEn } from "../namespaces/admin-limit-policy";
import { adminMemberQuotasEn } from "../namespaces/admin-member-quotas";
import { adminCommonEn } from "../namespaces/admin-common";
import { adminOverviewEn } from "../namespaces/admin-overview";
import { recordingProjectEn } from "../namespaces/recording-project";
import { workflowGrantsEn } from "../namespaces/workflow-grants";
import { orgHomeConfigEn } from "../namespaces/org-home-config";
import { orgProfileEn } from "../namespaces/org-profile";
import { localOrgEn } from "../namespaces/local-org";
import { adminNavigationEn } from "../namespaces/admin-navigation";
import { brainViewsEn } from "../namespaces/brain-views";
import { projectBrainEn } from "../namespaces/project-brain";
import { chatEn } from "../namespaces/chat";
import { enTasks } from "./tasks";
import { enFailures } from "./failures";
import { controlsEn } from "../namespaces/controls";
import { publicDesignShareEn } from "../namespaces/public-design-share";
import { projectListEn } from "../namespaces/project-list";
import { projectOverviewEn } from "../namespaces/project-overview";
import { activityEn } from "../namespaces/activity";
import { profileEn } from "../namespaces/profile";
import { projectPreparationEn } from "../namespaces/project-preparation";
import { notificationsEn } from "../namespaces/notifications";
import { projectResourcesEn } from "../namespaces/project-resources";
import { aboutMemoryEn } from "../namespaces/about-memory";
import { orgMembersEn } from "../namespaces/org-members";
import { orgMembersPreviewEn } from "../namespaces/org-members-preview";
import { orgSharedInvitesEn } from "../namespaces/org-shared-invites";
import { workbenchHomeEn } from "../namespaces/workbench-home";
import { inboxEn } from "../namespaces/inbox";
import { designDocumentEn } from "../namespaces/design-document";
import { designLoopCommonEn } from "../namespaces/design-loop-common";
import { stateEn } from "../namespaces/state";
import { workflowRunsEn } from "../namespaces/workflow-runs";
import { projectResultsEn } from "../namespaces/project-results";
import { workshopOverviewEn } from "../namespaces/workshop-overview";
import { projectWorkbenchEn } from "../namespaces/project-workbench";
import type { zhCN } from "./zh-CN";
import { accountEntryEn } from "../namespaces/account-entry";
import { invitationEntryEn } from "../namespaces/invitation-entry";
export const en: Record<keyof typeof zhCN, string> = {
  ...aiCatalogAdminEn,
  ...orgOverviewRedesignEn,
  ...orgPeopleRedesignEn,
  ...orgControlsRedesignEn,
  ...workshopLiveEn,
  ...platformOpsStatusEn,
  ...modelTestbenchEn,
  ...platformModelCatalogEn,
  ...telemetrySettingsEn,
  ...platformMembersEn,
  ...surveyTemplatesEn,
  ...surveyResultsEn,
  ...surveyPublicEn,
  ...surveyWorkspaceEn,
  ...surveyRuntimeErrorsEn,
  ...surveyLibraryEn,
  ...surveyDesignEn,
  ...aiUsageEn,
  ...adminLimitPolicyEn,
  ...adminMemberQuotasEn,
  ...adminCommonEn,
  ...adminOverviewEn,
  ...workflowGrantsEn,
  ...orgHomeConfigEn,
  ...orgProfileEn,
  ...localOrgEn,
  ...brainViewsEn,
  ...projectBrainEn,
  ...chatEn,
  ...enTasks,
  ...enFailures,
  ...controlsEn,
  ...publicDesignShareEn,
  ...projectListEn,
  ...projectOverviewEn,
  ...activityEn,
  ...profileEn,
  ...projectPreparationEn,
  ...notificationsEn,
  ...projectResourcesEn,
  ...aboutMemoryEn,
  ...orgMembersEn,
  ...orgMembersPreviewEn,
  ...orgSharedInvitesEn,
  ...workbenchHomeEn,
  ...inboxEn,
  ...designDocumentEn,
  ...designLoopCommonEn,
  ...stateEn,
  ...chatShareEn,
  ...codeFenceEn,
  ...workflowRunsEn,
  ...projectResultsEn,
  ...workshopOverviewEn,
  ...projectWorkbenchEn,
  "common.language": "Language",
  "skill.review.version": "Review gates · Version {version}",
  "skill.review.help": "Security scanning and methodology review are separate gates. A different methodology reviewer must approve the skill before it becomes enabled.",
  "skill.review.defaultReason": "I reviewed the contract and data scope statement and found that they meet the methodology requirements.",
  "skill.review.error": "{action} was rejected: {error}",
  "skill.review.scanResult": "Security scan result: {verdict} ({count} findings)",
  "skill.review.submitResult": "Submitted for manual review: {status}",
  "skill.review.approveResult": "Methodology review approved: {status} (review record {record})",
  "skill.review.returnResult": "Returned for changes: {status}",
  "skill.review.noVersion": "This skill has no version to review.",
  "skill.review.scan": "Security scan",
  "skill.review.submit": "Submit for review",
  "skill.review.approve": "Approve",
  "skill.review.return": "Return for changes",
  "skill.review.reason": "Review reason (required, recorded)",
  "home.greeting": "Hello, {name}",
  "ui.viewAll": "View all",
  "ui.quickActions": "Quick actions",
  "ui.recommendedAgents": "Recommended agents",
  "ui.exploreAllAgents": "Explore all agents",
  "ui.yourAiCollaborators": "Your AI collaborators",
  "ui.chooseAnAiPartnerToDiscussYourQuestionsAndIdeas": "Choose an AI partner to discuss your questions and ideas.",
  "ui.aiAgent": "AI agent",
  "ui.startAChat": "Start a chat",
  "ui.recommendedByYourOrganization": "Recommended by your organization",
  "ui.skillLibrary": "Skill library",
  "ui.creatingAChat": "Creating a chat…",
  "ui.openTheNewChat": "Open the new chat",
  "ui.currentTasks": "Current tasks",
  "ui.myTasks": "My tasks",
  "ui.loading": "Loading…",
  "ui.tasksCouldNotBeLoaded": "Tasks could not be loaded",
  "ui.youHaveNoTasksToHandle": "You have no tasks to handle",
  "ui.activeProjects": "Active projects",
  "ui.noActiveProjectsYet": "No active projects yet",
  "ui.projectsCouldNotBeLoaded": "Projects could not be loaded",
  "ui.continueYourWork": "Continue your work",
  "ui.chats": "Chats",
  "ui.projects": "Projects",
  "ui.deepResearch": "Deep research",
  "ui.userInterviews": "User interviews",
  "ui.surveys": "Surveys",
  "ui.noRecentWorkYetGetStartedWithAnActionAbove": "No recent work yet. Get started with an action above.",
  "ui.haveAnIdeaOrAProblem": "Have an idea or a problem?",
  "ui.sendFeedback": "Send feedback",
  "ui.welcomeBack": "Welcome back",
  "ui.loadingYourHomePage": "Loading your home page…",
  "ui.organizationHomeBanner": "Organization home banner",
  "ui.organizationLogo": "Organization logo",
  "ui.inProgress": "In progress",
  "ui.awaitingApproval": "Awaiting approval",
  "ui.completed": "Completed",
  "ui.failed": "Failed",
  "ui.paused": "Paused",
  "ui.workshop": "Workshop",
  "ui.draft": "Draft",
  "ui.awaitingTopicApproval": "Awaiting topic approval",
  "ui.awaitingExpertApproval": "Awaiting expert approval",
  "ui.awaitingQuestionApproval": "Awaiting question approval",
  "ui.interviewInProgress": "Interview in progress",
  "ui.awaitingReport": "Awaiting report",
  "ui.quickInterview": "Quick interview",
  "ui.collectingResponses": "Collecting responses",
  "ui.published": "Published",
  "ui.accountMenu": "Account menu",
  "ui.profile": "Profile",
  "ui.personalBrain": "Personal Brain",
  "ui.myAiUsage": "My AI usage",
  "ui.signOut": "Sign out",
  "ui.organization": "Organization",
  "ui.organizationMenu": "Organization menu",
  "ui.currentOrganization": "Current organization",
  "ui.switchOrganization": "Switch organization",
  "ui.createOrganization": "Create organization",
  "ui.organizationSettings": "Organization settings",
  "ui.mainNavigation": "Main navigation",
  "ui.mainNavigationMobile": "Main navigation (mobile)",
  "ui.tasks": "Tasks",
  "ui.me": "Me",
  "ui.more": "More",
  "ui.moreDestinations": "More destinations",
  "ui.checkingYourSession": "Checking your session…",
  "ui.theIdentityServiceIsUnavailableYourSessionHasBeenPreserved": "The identity service is unavailable. Your session has been preserved.",
  "ui.retry": "Retry",
  "ui.resizeLeftPanel": "Resize left panel",
  "ui.collapseLeftPanel": "Collapse left panel",
  "ui.expandLeftPanel": "Expand left panel",
  "ui.resizeRightPanel": "Resize right panel",
  "ui.collapseRightPanel": "Collapse right panel",
  "ui.expandRightPanel": "Expand right panel",
  "ui.skipToMainContent": "Skip to main content",
  "ui.switchToLightMode": "Switch to light mode",
  "ui.switchToDarkMode": "Switch to dark mode",
  "ui.projectPerspective": "Project perspective",
  "ui.localModeLocalModelsOnlyDataStaysOnThisDevice": "Local mode · Local models only · Data stays on this device",
  "ui.thisOrganizationUsesSelfHostedModelsOnly": "This organization uses self-hosted models only",
  "ui.outsideAProjectProjectRolesDoNotApply": "Outside a project · Project roles do not apply",
  "ui.workEmail": "Work email",
  "ui.password": "Password",
  "ui.forgotPassword": "Forgot password?",
  "ui.backToSignIn": "Back to sign in",
  "ui.resetPassword": "Reset password",
  "ui.ifThisEmailIsRegisteredAResetEmailHasBeenSent": "If this email is registered, a reset email has been sent.",
  "ui.resettingYourPasswordSignsOutAllDevicesAndInvalidatesYourOldPassword": "Resetting your password signs out all devices and invalidates your old password.",
  "ui.sending": "Sending…",
  "ui.sendResetLink": "Send reset link",
  "ui.waitSecondsBetweenRequestsLimitPerDay": "Wait 60 seconds between requests. Limit: 5 per day.",
  "ui.atLeastCharacters": "At least 12 characters",
  "ui.hidePassword": "Hide password",
  "ui.showPassword": "Show password",
  "ui.incorrectEmailOrPassword": "Incorrect email or password",
  "ui.verifyYourEmailBeforeSigningInPleaseCheckYourInbox": "Verify your email before signing in. Please check your inbox.",
  "ui.signInIsUnavailablePleaseTryAgainLater": "Sign-in is unavailable. Please try again later.",
  "ui.signingIn": "Signing in…",
  "ui.signIn": "Sign in",
  "ui.passwordResetIsUnavailablePleaseTryAgainLater": "Password reset is unavailable. Please try again later.",
  "ui.requestSubmittedCheckYourInboxForTheVerificationEmailOrTryAgainLater": "Request submitted. Check your inbox for the verification email, or try again later.",
  "ui.tooManyAttemptsPleaseTryAgainLater": "Too many attempts. Please try again later.",
  "ui.incorrectEmailOrPasswordCheckYourDetailsAndTryAgain": "Incorrect email or password. Check your details and try again.",
  "ui.couldNotSendTheVerificationEmailPleaseTryAgainLater": "Could not send the verification email. Please try again later.",
  "ui.submitting": "Submitting…",
  "ui.resendVerificationEmail": "Resend verification email",
  "ui.otherSignInOptionsComingSoon": "Other sign-in options · Coming soon",
  "ui.comingSoon": "Coming soon",
  "ui.newHereCreateAnOrganizationAsItsFirstAdministrator": "New here? Create an organization as its first administrator ·",
  "ui.noAccountsYetCreateTheFirstAdministratorWithoutAnInvitationCode": "No accounts yet. Create the first administrator without an invitation code.",
  "ui.authenticationOrEmailIsUnavailableYourEmailHasBeenKeptSoYouCanRetry": "Authentication or email is unavailable. Your email has been kept so you can retry.",
  "ui.thisAccountIsDisabledOrNoLongerAMemberContactYourOrganizationAdministrator": "This account is disabled or no longer a member. Contact your organization administrator.",
  "ui.signedInOpeningYourWorkspace": "Signed in. Opening your workspace…",
  "ui.signInToWorkspacex": "Sign in to WorkspaceX",
  "ui.enterYourStrategicWorkspace": "Enter your strategic workspace.",
  "ui.teamworkAndKnowledgeTogetherInOneWorkspace": "Teamwork and knowledge, together in one workspace.",
  "ui.doGreatWork": "Do great work.",
  "ui.togetherWithAi": "Together with AI,",
  "ui.chat": "Chat",
  "ui.startANewConversation": "Start a new conversation",
  "ui.organizeYourWorkByProject": "Organize your work by project",
  "ui.researchAndReportsFromMultipleSources": "Research and reports from multiple sources",
  "ui.designInterviewsConductThemAndFindInsights": "Design interviews, conduct them, and find insights",
  "ui.designPublishAndCollectSurveys": "Design, publish, and collect surveys",
  "ui.recording": "Recording",
  "ui.liveTranscriptionAndMeetingNotes": "Live transcription and meeting notes",
  "ui.design": "Design",
  "ui.designsAndPrototypes": "Designs and prototypes",
  "ui.brain": "Brain",
  "ui.yourOrganizationMemory": "Your organization memory",
  "ui.whiteboardAndCollaboration": "Whiteboard and collaboration",
  "ui.myTasksAndToDos": "My tasks and to-dos",
  "ui.creditsAndSubscription": "Credits and subscription",
  "home.chatWith": "Chat with {name}{role}",
  "home.skillFailed": "Could not create a chat for “{name}”. Please try again later.",
  "home.skillNotMounted": "Could not load “{name}”. The skill may be unavailable or you may not have permission.",
  "home.artifacts": "{count} artifacts",
  "home.people": " and others ({count} people)",
  "home.progress": "Progress {progress}%",
  "home.experts": "Experts {completed}/{total}",
  "home.configFailed": "Could not load your home page. Please try again later.",
  "auth.resetDescription": "Enter your work email to receive a one-time reset link (valid for {hours} hours).",
  "auth.invited": "Invited to an organization? Open the activation link from your administrator to set your password. Contact them for a new link if it has expired.",
  "navigation.home": "Home",
  "navigation.chat": "Chats",
  "navigation.projects": "Projects",
  "navigation.whiteboard": "Board",
  "navigation.research": "Research",
  "navigation.interview": "Interviews",
  "navigation.recording": "Recording",
  "navigation.survey": "Surveys",
  "navigation.design-workbench": "Design",
  "navigation.feedback-drafts": "Feedback drafts",
  "navigation.brain": "Brain",
  "navigation.tasks": "Tasks",
  "navigation.workflows": "Workflows",
  "navigation.agent-directory": "Agents",
  "navigation.work-skill-catalog": "Skills",
  "navigation.templates": "Templates",
  "navigation.skills": "Skills and marketplace",
  "navigation.agent-runtime": "Agent runtime",
  "navigation.org-admin": "Organization",
  "navigation.asset-governance": "Asset Governance",
  "navigation.agent-interrupts": "Agent Interrupts",
  "navigation.plan-control": "Plan Control",
  "navigation.agent-kernel": "Agent Kernel",
  "navigation.chat-knowledge-graph": "Chat Knowledge Graph",
  "navigation.canvas": "Canvas",
  "navigation.billing-preview": "Billing Preview",
  "navigation.files": "Files",
  "navigation.group.work": "Work",
  "navigation.group.studio": "STUDIO",
  "navigation.group.capabilities": "Capabilities",
  "navigation.group.administration": "Administration",
  "account.signOut": "Sign out",
  "org.create": "Create organization",
  "auth.locked": "Too many attempts. Your account is temporarily locked. Try again in {minutes} minutes.",
  "auth.resendWait": "You can resend in {seconds} seconds",
  "auth.feishu": "Feishu",
  "org.menuCurrent": "Organization menu, current: {name}",
  "org.local": "Local workspace · Local models only",
  "role.admin": "Administrator",
  "role.lead": "Project lead",
  "role.consultant": "Member",
  "role.compliance": "Compliance lead",
  "role.facilitator": "Facilitator",
  "role.groupLead": "Group lead",
  "role.member": "Member",
  "role.observer": "Observer",
  "policy.promise": "Product guarantee · Always on",
  "policy.policy": "Organization policy · Configurable by admins",
  "policy.description": "An administrator has configured this organization to use self-hosted models only. This is a configurable policy, separate from the local workspace guarantee.",
  "feedback.short": "Feedback",
  "feedback.target": "Send feedback about {kind}{name}",
  "home.error.NO_ORG_MEMBERSHIP": "You are not a member of this organization and cannot view its home configuration.",
  "home.error.FORBIDDEN": "Only organization administrators can edit the home configuration.",
  "home.error.BANNER_ARTIFACT_NOT_OWNED": "This banner image is no longer available. Upload it again.",
  "home.error.BANNER_COLOR_REQUIRED": "Enter a color in #RRGGBB format for the custom color scheme.",
  "home.error.FILE_TOO_LARGE": "The image exceeds 5 MB. Choose a smaller image.",
  "home.error.UNSUPPORTED_CONTENT_TYPE": "Only PNG, JPEG, and WebP images are supported.",
  "common.error.network": "Could not connect to the server. Check your connection and try again.",
  "common.http.auth": "Your session has expired. Refresh the page and sign in again.",
  "common.http.forbidden": "You do not have permission to perform this action. Contact your administrator if you need access.",
  "common.http.notFound": "The requested item is no longer available.",
  "common.http.rateLimit": "Too many requests. Wait a moment and try again.",
  "common.http.server": "The server encountered an error. Please try again later.",
  "common.http.failure": "The request failed. Please try again later.",
  "home.artifacts.one": "{count} artifact",
  ...accountEntryEn,
  ...invitationEntryEn,
  ...adminNavigationEn,
  ...studioResearchEn,
  ...researchEn,
  ...studioHistoryEn,
  ...recordingEn,
  ...recordingProjectEn,
  ...audioInputEn,
  ...interviewEn,
};

import { codeFenceEn } from "../namespaces/code-fence";
import { chatShareEn } from "../namespaces/chat-share";

import { studioResearchEn } from "../namespaces/studio-research";

import { researchEn } from "../namespaces/research";

import { interviewEn } from "../namespaces/interview";

import { studioHistoryEn } from "../namespaces/studio-history";

import { recordingEn } from "../namespaces/recording";

import { audioInputEn } from "../namespaces/audio-input";
