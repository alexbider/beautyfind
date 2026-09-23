// Canonical system states (design: project/BeautyFind States.dc.html).
// Prefer these over page-local empty states so every page follows the same rules:
// say what happened, offer at least two ways forward, never pad with unverified businesses.

export { NoResults, resultsLabel, type ActiveFilter, type WidenOption } from './NoResults';
export { AreaAlertForm } from './AreaAlertForm';
export { EmptyArea, verifiedClinics, type NearbyArea } from './EmptyArea';
export { UnclaimedBanner, UnclaimedFacts, UnclaimedActions, type UnclaimedFact } from './Unclaimed';
export { NewBusiness, DEFAULT_ZERO_KPIS, type SetupTask, type ZeroKpi } from './NewBusiness';
export { CardSkeleton } from './CardSkeleton';
export { ErrorState, errorStateClasses } from './ErrorState';
