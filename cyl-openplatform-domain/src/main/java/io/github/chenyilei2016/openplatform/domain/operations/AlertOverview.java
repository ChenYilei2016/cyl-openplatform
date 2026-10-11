package io.github.chenyilei2016.openplatform.domain.operations;

import java.util.List;
public record AlertOverview(OperationsAlertPolicy policy, List<AlertState> states, boolean stale) {
    public AlertOverview { states = List.copyOf(states); }
}
