package io.github.chenyilei2016.openplatform.domain.access;

public interface EmployeeDirectory {
    EmployeeIdentity find(String tenantId, String employeeNo);
}
