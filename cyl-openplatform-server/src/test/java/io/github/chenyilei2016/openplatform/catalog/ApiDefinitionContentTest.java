package io.github.chenyilei2016.openplatform.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionContent;
import java.util.Arrays;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class ApiDefinitionContentTest {
    private final JsonMapper json = JsonMapper.builder()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    @Test
    void everyContractFieldExceptIdentityAndRevisionParticipatesInComparison() {
        ApiDefinition definition = json.readValue("{\"draftRevision\":1}", ApiDefinition.class);
        assertThat(ApiDefinitionContent.changedFields(null, definition)).containsExactlyInAnyOrderElementsOf(
                Arrays.stream(ApiDefinition.class.getRecordComponents()).map(component -> component.getName())
                        .filter(name -> !Set.of("id", "draftRevision").contains(name)).toList());
    }

    @Test
    void numericRepresentationIsIgnoredWithoutRoundingAwayBusinessValues() {
        ApiDefinition before = json.readValue("""
                {"draftRevision":1,"mappings":[{"target":"value","source":"FIXED","value":{
                  "integer":9007199254740993,"decimal":1.00000000000000000001}}]}
                """, ApiDefinition.class);
        ApiDefinition equivalent = json.readValue("""
                {"id":"another-id","draftRevision":99,"mappings":[{"target":"value","source":"FIXED","value":{
                  "decimal":1.000000000000000000010,"integer":9007199254740993.0}}]}
                """, ApiDefinition.class);
        assertThat(ApiDefinitionContent.changedFields(before, equivalent)).isEmpty();
        ApiDefinition different = json.readValue("""
                {"draftRevision":1,"mappings":[{"target":"value","source":"FIXED","value":{
                  "integer":9007199254740992,"decimal":1.00000000000000000002}}]}
                """, ApiDefinition.class);
        assertThat(ApiDefinitionContent.changedFields(before, different)).containsExactly("mappings");
    }
}
