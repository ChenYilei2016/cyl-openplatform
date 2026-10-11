package io.github.chenyilei2016.openplatform.application.importing;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.catalog.ApiDraftSaveResult;
import io.github.chenyilei2016.openplatform.application.catalog.McpToolNamePolicy;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.application.connection.DubboBindingPolicy;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import static io.github.chenyilei2016.openplatform.application.importing.ImportModels.*;
import static io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionContent.changedFields;

/** 导入只修改研发明确选中的草稿；按scope→目录锁顺序整批提交，不触碰发布快照。 */
@Service
public class ApiImportService {
    private final ApiCatalogRepository catalog;
    private final io.github.chenyilei2016.openplatform.application.catalog.CatalogReferencePolicy references;
    private final ScopeRepository scopes;
    private final ApiDefinitionCodec codec;
    private final DubboBindingPolicy bindings;
    private final TransactionTemplate changes;
    private final ApiImportReceiptRepository receipts;
    private final HttpImportTargetPolicy httpTargets;
    private final McpToolNamePolicy toolNames;

    public ApiImportService(ApiCatalogRepository catalog, ScopeRepository scopes,
                            ApiDefinitionCodec codec, DubboBindingPolicy bindings, PlatformTransactionManager transactions,
                            ApiImportReceiptRepository receipts, HttpImportTargetPolicy httpTargets,
                            io.github.chenyilei2016.openplatform.application.catalog.CatalogReferencePolicy references,
                            McpToolNamePolicy toolNames) {
        this.references=references;
        this.toolNames = toolNames;
        this.catalog = catalog;
        this.scopes = scopes;
        this.codec = codec;
        this.bindings = bindings;
        this.receipts = receipts;
        this.httpTargets = httpTargets;
        changes = new TransactionTemplate(transactions);
        changes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    public Confirmation submit(ParsedDocument document, List<Selection> selections, AccessOperator operator,
                               String submissionKey, String sourceKind, String sourceDigest) {
        validateSubmissionKey(submissionKey);
        ApiImportReceiptRepository.SourceKind.parse(sourceKind);
        if (sourceDigest == null || !sourceDigest.matches("[0-9a-f]{64}"))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "导入来源种类或摘要无效");
        String digest = io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets.digest(
                document.digest() + "\n" + selections + "\n" + sourceKind + "\n" + sourceDigest);
        return changes.execute(transaction -> {
            ApiImportReceiptRepository.Receipt receipt = receipts.reserve(operator, submissionKey, digest, sourceKind, sourceDigest);
            if (!receipt.contentDigest().equals(digest))
                throw new PlatformException(ErrorCode.CONFLICT, "该提交标识已用于其他内容，请查询原提交结果");
            if (receipt.result() != null) return receipt.result();
            Confirmation result = confirm(document, selections, operator);
            receipts.complete(operator, submissionKey, result);
            return result;
        });
    }

    public Confirmation result(String submissionKey, AccessOperator operator) {
        validateSubmissionKey(submissionKey);
        return receipts.find(operator, submissionKey).map(ApiImportReceiptRepository.Receipt::result)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "原提交暂无成功回执，可使用原标识和原内容重试"));
    }

    public ApiImportReceiptRepository.SourceInfo provenance(String apiId, long revision) {
        if (apiId == null || !apiId.matches("[A-Za-z0-9_-]{1,36}") || revision < 1)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "API编号和修订号不合法");
        return receipts.provenance(apiId, revision).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND,
                "该修订未记录导入来源，可能是历史记录或其他方式创建；不能推断原始资料"));
    }

    private void validateSubmissionKey(String key) {
        if (key == null || !key.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "提交标识必须为UUID");
    }

    public Preview preview(ParsedDocument document) {
        List<SourceItem> source = validateSource(document);
        List<ApiDefinition> valid = source.stream().filter(item -> item.errors().isEmpty()).map(SourceItem::definition).toList();
        Map<ApiOperation, ApiDefinition> existing = catalog.findOperations(valid.stream().map(ApiOperation::of).toList())
                .stream().collect(Collectors.toMap(ApiOperation::of, Function.identity()));
        io.github.chenyilei2016.openplatform.application.catalog.CatalogReferencePolicy.Available available=references.check(valid,false);
        Map<ApiOperation, String> toolConflicts = toolNames.conflicts(valid);
        Set<String> enabled = new HashSet<>(scopes.enabledCodes(valid.stream()
                .flatMap(api -> api.scopeCodes().stream()).distinct().sorted().toList()));
        Map<ApiOperation, String> bindingErrors = bindings.errors(valid.stream().map(definition ->
                new DubboBindingPolicy.Candidate(definition, existing.get(ApiOperation.of(definition)))).toList());
        List<PreviewItem> items = source.stream().map(item -> {
            ApiDefinition definition = item.definition();
            ApiOperation operation = definition == null ? item.operation() : ApiOperation.of(definition);
            ApiDefinition before = existing.get(operation);
            List<String> errors = new ArrayList<>(item.errors());
            HttpImportTargetPolicy.Decision target = errors.isEmpty()
                    ? httpTargets.check(before, definition) : HttpImportTargetPolicy.Decision.PERMITTED;
            if (target.error() != null) errors.add(target.error());
            if (errors.isEmpty()) available.issues(definition).forEach(issue -> errors.add(issue.message()));
            if (errors.isEmpty() && !enabled.containsAll(definition.scopeCodes())) {
                List<String> unavailableScopes = definition.scopeCodes().stream()
                        .filter(code -> !enabled.contains(code)).sorted().toList();
                errors.add("权限组不存在或已停用：" + String.join("、", unavailableScopes));
            }
            if (errors.isEmpty() && toolConflicts.containsKey(operation)) errors.add(toolConflicts.get(operation));
            if (errors.isEmpty() && bindingErrors.containsKey(operation)) errors.add(bindingErrors.get(operation));
            if (before != null && definition != null && definition.description() == null
                    && before.description() != null && !before.description().isEmpty()) errors.add("已有接口说明，导入需携带description；清空请明确传空字符串");
            if (before != null && before.draftRevision() == Long.MAX_VALUE) errors.add("草稿修订号已达上限");
            List<String> fields = definition == null ? List.of() : changedFields(before, definition);
            Change change = !errors.isEmpty() ? Change.ERROR : before == null ? Change.CREATE
                    : fields.isEmpty() ? Change.UNCHANGED : Change.UPDATE;
            ApiDefinition after = definition == null ? null : change == Change.UNCHANGED ? before : withIdentity(definition,
                    before == null ? ObjectIdType.API.nextId() : before.id(),
                    before == null ? 1 : before.draftRevision() == Long.MAX_VALUE ? Long.MAX_VALUE
                            : before.draftRevision() + 1);
            if (errors.isEmpty()) {
                try { codec.encode(after); }
                catch (PlatformException invalid) { errors.add(invalid.getMessage()); change = Change.ERROR; }
            }
            return new PreviewItem(item.index(), operation, change, before == null ? 0 : before.draftRevision(),
                    fields, before, after, List.copyOf(errors), target.warning() == null ? List.of() : List.of(target.warning()));
        }).toList();
        return new Preview(document.digest(), items);
    }

    public Confirmation confirm(ParsedDocument document, List<Selection> selections, AccessOperator operator) {
        List<SourceItem> source = validateSource(document);
        if (selections == null || selections.isEmpty() || selections.size() > 20)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "请选择1–20项创建或更新");
        Set<Integer> indices = new HashSet<>();
        for (Selection selection : selections) {
            if (selection == null || selection.index() < 0 || selection.index() >= source.size()
                    || !indices.add(selection.index()) || selection.expectedRevision() < 0
                    || selection.expectedRevision() == Long.MAX_VALUE)
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "选择索引或预期修订号不合法、重复或超出范围");
        }
        try {
            return changes.execute(transaction -> {
                List<ApiDefinition> valid = selections.stream().map(selection -> source.get(selection.index()))
                        .filter(item -> item.errors().isEmpty()).map(SourceItem::definition).toList();
                List<ApiDefinition> candidates = catalog.findOperations(valid.stream().map(ApiOperation::of).toList());
                List<String> codes = valid.stream().flatMap(api -> api.scopeCodes().stream()).distinct().sorted().toList();
                if (!scopes.allEnabled(codes)) {
                    // 未锁到全部可用scope即拒绝；并发启用不能通过后续只读回查补足授权锁。
                    throw new ImportRejected(ErrorCode.INVALID_REQUEST, selections.stream().map(selection -> {
                        SourceItem item = source.get(selection.index());
                        return new ItemResult(item.index(), Change.ERROR, null, null, item.errors().isEmpty()
                                ? List.of("同批权限组不存在、已停用或状态变更，整批未写入，请重新预览") : item.errors());
                    }).toList());
                }
                io.github.chenyilei2016.openplatform.application.catalog.CatalogReferencePolicy.Available available=references.check(valid,true);
                Map<ApiOperation, String> toolConflicts = toolNames.conflicts(valid);
                Map<ApiOperation, ApiDefinition> existing = catalog.lockAll(candidates.stream().map(ApiDefinition::id).sorted().toList())
                        .stream().collect(Collectors.toMap(ApiOperation::of, Function.identity()));
                Map<ApiOperation, String> bindingErrors = bindings.errors(valid.stream().map(definition ->
                        new DubboBindingPolicy.Candidate(definition, existing.get(ApiOperation.of(definition)))).toList());
                List<ApiDefinition> creates = new ArrayList<>();
                List<ApiDefinition> updates = new ArrayList<>();
                List<ItemResult> results = new ArrayList<>();
                ErrorCode rejection = null;
                for (Selection selection : selections) {
                    SourceItem item = source.get(selection.index());
                    ApiDefinition definition = item.definition();
                    List<String> errors = new ArrayList<>(item.errors());
                    ApiDefinition before = definition == null ? null : existing.get(ApiOperation.of(definition));
                    if (errors.isEmpty()) available.issues(definition).forEach(issue -> errors.add(issue.message()));
                    if (errors.isEmpty() && toolConflicts.containsKey(ApiOperation.of(definition)))
                        errors.add(toolConflicts.get(ApiOperation.of(definition)));
                    if (errors.isEmpty()) {
                        HttpImportTargetPolicy.Decision target = httpTargets.check(before, definition);
                        if (target.error() != null) errors.add(target.error());
                    }
                    if (errors.isEmpty() && bindingErrors.containsKey(ApiOperation.of(definition)))
                        errors.add(bindingErrors.get(ApiOperation.of(definition)));
                    if (before != null && definition != null && definition.description() == null
                            && before.description() != null && !before.description().isEmpty()) errors.add("已有接口说明，导入需携带description；清空请明确传空字符串");
                    boolean stale = errors.isEmpty() && (before == null ? selection.expectedRevision() != 0
                            : selection.expectedRevision() != before.draftRevision());
                    if (stale) {
                        errors.add("操作已创建或草稿修订已变更，请重新预览");
                        rejection = ErrorCode.CONFLICT;
                    }
                    if (!errors.isEmpty()) {
                        if (rejection == null) rejection = ErrorCode.INVALID_REQUEST;
                        results.add(new ItemResult(item.index(), Change.ERROR, before == null ? null : before.id(),
                                before == null ? null : before.draftRevision(), List.copyOf(errors)));
                        continue;
                    }
                    ApiDefinition after = withIdentity(definition, before == null ? ObjectIdType.API.nextId() : before.id(),
                            selection.expectedRevision() + 1);
                    ApiDraftSaveResult saved = ApiDraftSaveResult.prepare(before, after, selection.expectedRevision());
                    if (!saved.changed()) {
                        results.add(new ItemResult(item.index(), Change.UNCHANGED, before.id(), before.draftRevision(), List.of()));
                        continue;
                    }
                    try { codec.encode(after); }
                    catch (PlatformException invalid) {
                        if (rejection == null) rejection = ErrorCode.INVALID_REQUEST;
                        results.add(new ItemResult(item.index(), Change.ERROR, before == null ? null : before.id(),
                                before == null ? null : before.draftRevision(), List.of(invalid.getMessage())));
                        continue;
                    }
                    if (before == null) creates.add(after); else updates.add(after);
                    results.add(new ItemResult(item.index(), before == null ? Change.CREATE : Change.UPDATE,
                            after.id(), after.draftRevision(), List.of()));
                }
                if (rejection != null) throw new ImportRejected(rejection, results.stream().map(result ->
                        result.errors().isEmpty() ? new ItemResult(result.index(), Change.ERROR, null, null,
                                List.of("同批其他条目校验失败，本项未写入")) : result).toList());
                catalog.writeImported(creates, updates, operator);
                return new Confirmation(true, List.copyOf(results));
            });
        } catch (DataIntegrityViolationException | OptimisticLockingFailureException conflict) {
            // 唯一键竞争或修订条件失败已经回滚；连接提交结果未知等其他异常继续交给统一异常处理。
            throw new ImportRejected(ErrorCode.CONFLICT, selections.stream().map(selection ->
                    new ItemResult(selection.index(), Change.ERROR, null, null,
                            List.of("同批操作发生并发冲突，整批未写入，请重新预览"))).toList());
        }
    }

    private List<SourceItem> validateSource(ParsedDocument document) {
        if (document == null || document.items() == null || document.items().isEmpty() || document.items().size() > 20)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "导入文档必须包含1–20项契约");
        Map<ApiOperation, Long> counts = document.items().stream().map(SourceItem::definition).filter(Objects::nonNull)
                .collect(Collectors.groupingBy(ApiOperation::of, Collectors.counting()));
        return document.items().stream().map(item -> {
            List<String> errors = new ArrayList<>(item.errors());
            ApiDefinition definition = item.definition();
            if (definition == null && errors.isEmpty()) errors.add("契约缺失");
            if (definition != null && counts.get(ApiOperation.of(definition)) > 1) errors.add("同一来源包含重复操作标识");
            if (definition != null && errors.isEmpty()) {
                try {
                    definition.validate();
                } catch (PlatformException invalid) {
                    errors.add(invalid.getMessage());
                }
            }
            return new SourceItem(item.index(), item.operation(), definition, List.copyOf(errors));
        }).toList();
    }

    private static ApiDefinition withIdentity(ApiDefinition source, String id, long revision) {
        return new ApiDefinition(id, source.service(), source.version(), source.method(), source.name(), source.category(),
                source.owner(), source.protocol(), revision, source.scopeCodes(), source.requestSchema(), source.responseSchema(),
                source.errorDefinitions(), source.binding(), source.mappings(), source.lifecycle(), source.description(), source.employeeRequired(), source.responseAdapter(),
                source.operationKind(), source.idempotencyField(), source.mcpTool());
    }
}
