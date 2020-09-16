/** @prettier */
import { Subscriber } from '../Subscriber';
import { Observable } from '../Observable';
import { Subject } from '../Subject';
import { Subscription } from '../Subscription';
import { ObservableInput, OperatorFunction } from '../types';
import { lift } from '../util/lift';
import { from } from '../observable/from';
import { OperatorSubscriber } from './OperatorSubscriber';
import { noop } from '../util/noop';
import { arrRemove } from '../util/arrRemove';

/**
 * Branch out the source Observable values as a nested Observable starting from
 * an emission from `openings` and ending when the output of `closingSelector`
 * emits.
 *
 * <span class="informal">It's like {@link bufferToggle}, but emits a nested
 * Observable instead of an array.</span>
 *
 * ![](windowToggle.png)
 *
 * Returns an Observable that emits windows of items it collects from the source
 * Observable. The output Observable emits windows that contain those items
 * emitted by the source Observable between the time when the `openings`
 * Observable emits an item and when the Observable returned by
 * `closingSelector` emits an item.
 *
 * ## Example
 * Every other second, emit the click events from the next 500ms
 * ```ts
 * import { fromEvent, interval, EMPTY } from 'rxjs';
 * import { windowToggle, mergeAll } from 'rxjs/operators';
 *
 * const clicks = fromEvent(document, 'click');
 * const openings = interval(1000);
 * const result = clicks.pipe(
 *   windowToggle(openings, i => i % 2 ? interval(500) : EMPTY),
 *   mergeAll()
 * );
 * result.subscribe(x => console.log(x));
 * ```
 *
 * @see {@link window}
 * @see {@link windowCount}
 * @see {@link windowTime}
 * @see {@link windowWhen}
 * @see {@link bufferToggle}
 *
 * @param {Observable<O>} openings An observable of notifications to start new
 * windows.
 * @param {function(value: O): Observable} closingSelector A function that takes
 * the value emitted by the `openings` observable and returns an Observable,
 * which, when it emits (either `next` or `complete`), signals that the
 * associated window should complete.
 * @return {Observable<Observable<T>>} An observable of windows, which in turn
 * are Observables.
 * @name windowToggle
 */
export function windowToggle<T, O>(
  openings: ObservableInput<O>,
  closingSelector: (openValue: O) => ObservableInput<any>
): OperatorFunction<T, Observable<T>> {
  return (source: Observable<T>) =>
    lift(source, function (this: Subscriber<Observable<T>>, source: Observable<T>) {
      const subscriber = this;
      const windows: Subject<T>[] = [];

      const handleError = (err: any) => {
        while (0 < windows.length) {
          windows.shift()!.error(err);
        }
        subscriber.error(err);
      };

      let openNotifier: Observable<O>;
      try {
        openNotifier = from(openings);
      } catch (err) {
        subscriber.error(err);
        return;
      }
      openNotifier.subscribe(
        new OperatorSubscriber(
          subscriber,
          (openValue) => {
            const window = new Subject<T>();
            windows.push(window);
            const closingSubscription = new Subscription();
            const closeWindow = () => {
              arrRemove(windows, window);
              window.complete();
              closingSubscription.unsubscribe();
            };
            const closingSubscriber = new OperatorSubscriber(subscriber, closeWindow, handleError, closeWindow);

            let closingNotifier: Observable<any>;
            try {
              closingNotifier = from(closingSelector(openValue));
            } catch (err) {
              handleError(err);
              return;
            }

            subscriber.next(window.asObservable());

            closingSubscription.add(closingNotifier.subscribe(closingSubscriber));
          },
          undefined,
          noop
        )
      );

      // Subcribe to the source to get things started.
      source.subscribe(
        new OperatorSubscriber(
          subscriber,
          (value: T) => {
            // Copy the windows array before we emit to
            // make sure we don't have issues with reentrant code.
            const windowsCopy = windows.slice();
            for (const window of windowsCopy) {
              window.next(value);
            }
          },
          handleError,
          () => {
            // Complete all of our windows before we complete.
            while (0 < windows.length) {
              windows.shift()!.complete();
            }
            subscriber.complete();
          },
          () => {
            // Add this teardown so that all window subjects are
            // disposed of. This way, if a user tries to subscribe
            // to a window *after* the outer subscription has been unsubscribed,
            // they will get an error, instead of waiting forever to
            // see if a value arrives.
            while (0 < windows.length) {
              windows.shift()!.unsubscribe();
            }
          }
        )
      );
    });
}
