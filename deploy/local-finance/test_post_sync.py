import unittest
from unittest.mock import MagicMock,patch
import post_sync

class PostSyncTests(unittest.TestCase):
    def test_idle_watcher_does_not_log_in_or_call_banks(self):
        with patch.object(post_sync,'redis',return_value=''),patch.object(post_sync,'Api') as api:
            post_sync.main()
            api.assert_not_called()
    def test_active_sync_retains_pending_notification(self):
        api=MagicMock();api.__enter__.return_value.request.return_value={'accounts':[{'status':'queued'}]}
        with patch.object(post_sync,'redis',return_value='generation') as redis,patch.object(post_sync,'Api',return_value=api),patch.object(post_sync,'classify') as classify:
            post_sync.main()
            classify.assert_not_called()
            self.assertEqual(redis.call_count,1)
    def test_completed_sync_classifies_then_compare_deletes_generation(self):
        api=MagicMock();api.__enter__.return_value.request.return_value={'accounts':[{'status':'completed'}]}
        with patch.object(post_sync,'redis',return_value='generation') as redis,patch.object(post_sync,'Api',return_value=api),patch.object(post_sync,'classify',return_value={'changed':0}) as classify:
            post_sync.main()
            classify.assert_called_once()
            self.assertEqual(redis.call_args.args[-1],'generation')
            self.assertEqual(redis.call_args.args[0],'EVAL')

if __name__=='__main__':unittest.main()
