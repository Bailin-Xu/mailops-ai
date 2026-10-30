import pytest
from store import checkpoint_url
from api import from_environment


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://mailops@127.0.0.1:5433/mailops",
        "postgresql://mailops_test@127.0.0.1:5434/mailops_test",
        "postgresql://mailops_agent_checkpoint@remote:5436/mailops_agent_checkpoint",
        "postgresql://mailops_agent_checkpoint@127.0.0.1:5436/mailops_agent_checkpoint?options=bad",
    ],
)
def test_checkpoint_target_never_falls_back(url):
    with pytest.raises(ValueError):
        checkpoint_url(url)


def test_production_factory_requires_explicit_checkpoint_store(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "mock")
    monkeypatch.setenv("AGENT_TRACE_EXPORT_ENABLED", "false")
    monkeypatch.delenv("AGENT_CHECKPOINT_DATABASE_URL", raising=False)
    with pytest.raises(KeyError):
        from_environment()
